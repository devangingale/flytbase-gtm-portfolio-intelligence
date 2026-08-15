"""
Postgres (Supabase) storage layer for the FlytBase GTM Portfolio Intelligence
System.

Owns the five tables that hold document provenance, extracted claims,
derived account state, generated actions, and the human-readable change
log (Master PRD section 6):

    documents(id, account_id, type, title, doc_date, raw_payload,
              content_hash, fetched_at, is_present, withdrawn_at)
    claims(id, account_id, field, value, confidence, source_doc_ids,
           extracted_at, invalidated_at, invalidation_reason)
    account_state(account_id, derived_health, crm_label, mismatch,
                  mismatch_reason, stage, arr, renewal_date, payload,
                  derived_at, is_dirty)
    actions(id, account_id, action, why, reason_codes, urgency, bucket,
            source_doc_ids, created_at)
    change_log(id, at, account_id, type, description, consequence)

Originally SQLite (a local file); switched to Postgres via Supabase because
the app runs on Render, whose free tier has no persistent disk and spins
down idle instances, both of which are fatal to a local SQLite file and the
in-process sync loop. See DECISIONS.md for the full rationale.

To avoid touching every caller (backend/sync_worker.py, backend/pipeline.py,
backend/main.py all call conn.execute(sql, params).fetchone()/.fetchall() or
.rowcount directly, not just the helpers below, exactly like the sqlite3
API), this module exposes a thin _PgConnection/_PgCursor adapter that mimics
that same chaining shape on top of psycopg2: "?" placeholders are rewritten
to "%s", rows come back dict-like (RealDictCursor), and .rowcount/.lastrowid
behave the same way callers already expect from sqlite3.

Array-typed columns (source_doc_ids, reason_codes) are still stored as
JSON-encoded TEXT via encode_list / decode_list below, exactly as under
SQLite (kept as TEXT rather than migrated to native Postgres jsonb/text[] to
minimize risk in every other already-verified module that reads/writes these
columns). Every module that touches these columns should use those two
helpers rather than json.dumps/json.loads directly, to keep encoding
consistent (empty/None both round-trip to []).

Usage:
    python backend/db.py     # connect, ensure schema, print table list
"""

import os
import re
import json
import pathlib
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DEFAULT_DB_PATH = str(pathlib.Path(__file__).resolve().parent.parent / "gtm.db")
# Kept for backward compatibility with any code/logs that still reference a
# file-like DB_PATH (e.g. sync_worker._job_db_path's fallback). Under
# Postgres this is never actually used to open a connection; DATABASE_URL is.
DB_PATH = os.environ.get("DB_PATH", DEFAULT_DB_PATH)

DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or os.environ.get("SUPABASE_DB_URL")
    or os.environ.get("POSTGRES_URL")
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    type TEXT,
    title TEXT,
    doc_date TEXT,
    raw_payload TEXT,
    content_hash TEXT,
    fetched_at TEXT,
    is_present INTEGER NOT NULL DEFAULT 1,
    withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_account_id ON documents(account_id);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    field TEXT,
    value TEXT,
    confidence TEXT,
    source_doc_ids TEXT,
    extracted_at TEXT,
    invalidated_at TEXT,
    invalidation_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_account_id ON claims(account_id);

CREATE TABLE IF NOT EXISTS account_state (
    account_id TEXT PRIMARY KEY,
    derived_health TEXT,
    crm_label TEXT,
    mismatch INTEGER NOT NULL DEFAULT 0,
    mismatch_reason TEXT,
    stage TEXT,
    arr REAL,
    renewal_date TEXT,
    payload TEXT,
    derived_at TEXT,
    is_dirty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    action TEXT,
    why TEXT,
    reason_codes TEXT,
    urgency INTEGER,
    bucket TEXT,
    source_doc_ids TEXT,
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_account_id ON actions(account_id);

CREATE TABLE IF NOT EXISTS change_log (
    id BIGSERIAL PRIMARY KEY,
    at TEXT,
    account_id TEXT,
    type TEXT,
    description TEXT,
    consequence TEXT
);
CREATE INDEX IF NOT EXISTS idx_change_log_account_id ON change_log(account_id);
"""


def _now():
    return datetime.now(timezone.utc).isoformat()


def _strip_em_dash(text: str) -> str:
    """Replace em dashes with a comma, per Master PRD rule 6 (no em dashes
    anywhere). Applied to system-generated change_log text, which sometimes
    interpolates verbatim source titles that contain one."""
    if not text:
        return text
    return text.replace("—", ",")


# ---------------------------------------------------------------------------
# Array-column encode/decode helpers. Use these everywhere source_doc_ids or
# reason_codes is read or written so every module agrees on the wire format.
# ---------------------------------------------------------------------------

def encode_list(value) -> str:
    """Encode a Python list (or None) into the JSON TEXT stored in the db."""
    if value is None:
        return "[]"
    return json.dumps(list(value))


def decode_list(text) -> list:
    """Decode a JSON TEXT column back into a Python list. Never raises,
    empty/None/unparseable input all become []."""
    if not text:
        return []
    try:
        result = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return []
    return result if isinstance(result, list) else []


# ---------------------------------------------------------------------------
# sqlite3-shaped adapter over psycopg2, so every existing caller
# (conn.execute(sql, params).fetchone()/.fetchall(), conn.commit(),
# conn.close(), row["col"], cur.rowcount) keeps working unchanged.
# ---------------------------------------------------------------------------

_QMARK_RE = re.compile(r"\?")


def _qmark_to_pyformat(sql: str) -> str:
    """Rewrite sqlite3-style "?" positional placeholders to psycopg2-style
    "%s". The schema/queries in this codebase never use a literal "?" inside
    a string literal, so a straight regex replace is safe here."""
    return _QMARK_RE.sub("%s", sql)


class _PgCursor:
    """Wraps a psycopg2 RealDictCursor so conn.execute(...) can be chained
    straight into .fetchone()/.fetchall(), matching the sqlite3.Cursor shape
    every caller in this codebase already relies on. dict(row) on a returned
    row works because RealDictRow already is a dict subclass."""

    def __init__(self, cursor, no_result=False):
        self._cursor = cursor
        # Set when this cursor backs a statement psycopg2 never executed
        # (the PRAGMA no-op path below), so .fetchone()/.fetchall() return
        # empty results instead of raising ProgrammingError("no results to
        # fetch") on a cursor that has nothing to fetch from.
        self._no_result = no_result

    def fetchone(self):
        if self._no_result:
            return None
        row = self._cursor.fetchone()
        return dict(row) if row is not None else None

    def fetchall(self):
        if self._no_result:
            return []
        return [dict(r) for r in self._cursor.fetchall()]

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def lastrowid(self):
        # psycopg2 has no cursor.lastrowid; callers needing the id of a row
        # they just inserted use RETURNING id and .fetchone() instead (see
        # append_change_log below), so this is only here for API parity and
        # is not expected to be read.
        return None


class _PgConnection:
    """Wraps a psycopg2 connection so conn.execute(sql, params) works the
    same way sqlite3.Connection.execute does (opens a cursor, runs the
    query, returns something .fetchone()/.fetchall()-able), and so
    conn.commit()/conn.close() are available directly on the connection
    object exactly as every caller already expects."""

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def execute(self, sql, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        pg_sql = _qmark_to_pyformat(sql)
        # PRAGMA is a SQLite-only statement. backend/sync_worker.py issues
        # "PRAGMA database_list" purely to introspect the on-disk file
        # backing a sqlite3.Connection, which has no Postgres equivalent or
        # purpose (there is no file, DATABASE_URL is the connection
        # descriptor). Returning an empty result lets that caller's existing
        # "row is None -> fall back to db.DB_PATH-like value" path run
        # unchanged rather than raising a syntax error against Postgres.
        if pg_sql.strip().upper().startswith("PRAGMA"):
            return _PgCursor(cur, no_result=True)
        cur.execute(pg_sql, params or ())
        return _PgCursor(cur)

    def executemany(self, sql, seq_of_params):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        pg_sql = _qmark_to_pyformat(sql)
        cur.executemany(pg_sql, list(seq_of_params))
        return _PgCursor(cur)

    def executescript(self, sql):
        cur = self._conn.cursor()
        cur.execute(sql)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def get_connection(db_path: str = None) -> _PgConnection:
    """Open a Postgres connection and ensure the schema exists. Safe to call
    repeatedly, every call runs CREATE TABLE IF NOT EXISTS. Returns a
    _PgConnection wrapper with the same .execute(...).fetchone()/.fetchall()
    chaining shape as sqlite3.Connection, so every existing caller keeps
    working unchanged.

    The `db_path` parameter name is a holdover from the SQLite version of
    this module (kept so every caller's positional/keyword call sites do
    not need to change). Under Postgres it is interpreted as a full
    connection string / DSN if given (falls back to DATABASE_URL /
    SUPABASE_DB_URL / POSTGRES_URL env vars otherwise); a bare filesystem
    path like the old default ("gtm.db") is not a valid DSN and is ignored
    in favor of the env var, since that only happens for legacy callers
    that never learned about the Postgres migration.
    """
    dsn = None
    if db_path and ("://" in db_path or db_path.strip().startswith("postgres")):
        dsn = db_path
    else:
        dsn = DATABASE_URL
    if not dsn:
        raise RuntimeError(
            "No Postgres connection string configured. Set DATABASE_URL "
            "(or SUPABASE_DB_URL / POSTGRES_URL) in the environment."
        )
    pg_conn = psycopg2.connect(dsn)
    pg_conn.autocommit = False
    conn = _PgConnection(pg_conn)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# documents
# ---------------------------------------------------------------------------

def upsert_document(
    conn,
    id: str,
    account_id: str,
    type: str,
    title: str,
    doc_date: str,
    raw_payload: str,
    content_hash: str,
    fetched_at: str = None,
    is_present: bool = True,
) -> None:
    """Insert or update a document row by id. Always sets is_present=True and
    clears withdrawn_at (used when a doc reappears after being withdrawn).
    fetched_at defaults to now (UTC ISO8601) if not given."""
    conn.execute(
        """
        INSERT INTO documents
            (id, account_id, type, title, doc_date, raw_payload, content_hash,
             fetched_at, is_present, withdrawn_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
        ON CONFLICT(id) DO UPDATE SET
            account_id = excluded.account_id,
            type = excluded.type,
            title = excluded.title,
            doc_date = excluded.doc_date,
            raw_payload = excluded.raw_payload,
            content_hash = excluded.content_hash,
            fetched_at = excluded.fetched_at,
            is_present = 1,
            withdrawn_at = NULL
        """,
        (
            id,
            account_id,
            type,
            title,
            doc_date,
            raw_payload,
            content_hash,
            fetched_at or _now(),
        ),
    )
    conn.commit()


def mark_document_withdrawn(conn, doc_id: str, reason: str = None) -> None:
    """Mark a document as no longer present (deletion detection). Sets
    is_present=0 and withdrawn_at=now. `reason` is informational, callers
    are expected to also append_change_log(type="document_withdrawn", ...)
    separately since that call needs the account_id and consequence text."""
    conn.execute(
        "UPDATE documents SET is_present = 0, withdrawn_at = ? WHERE id = ?",
        (_now(), doc_id),
    )
    conn.commit()


def get_present_documents(conn, account_id: str) -> list:
    """Return list[dict] of documents currently is_present=1 for an account."""
    rows = conn.execute(
        "SELECT * FROM documents WHERE account_id = ? AND is_present = 1 ORDER BY doc_date",
        (account_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# claims
# ---------------------------------------------------------------------------

def insert_claims(conn, claims: list) -> None:
    """Bulk insert claims. Each item is a dict with keys:
        id, account_id, field, value, confidence, source_doc_ids (list),
        extracted_at (optional, defaults to now)
    invalidated_at / invalidation_reason start NULL. source_doc_ids is
    encoded with encode_list before storage."""
    now = _now()
    rows = [
        (
            c["id"],
            c["account_id"],
            c.get("field"),
            c.get("value"),
            c.get("confidence"),
            encode_list(c.get("source_doc_ids")),
            c.get("extracted_at") or now,
        )
        for c in claims
    ]
    conn.executemany(
        """
        INSERT INTO claims
            (id, account_id, field, value, confidence, source_doc_ids,
             extracted_at, invalidated_at, invalidation_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(id) DO UPDATE SET
            account_id = excluded.account_id,
            field = excluded.field,
            value = excluded.value,
            confidence = excluded.confidence,
            source_doc_ids = excluded.source_doc_ids,
            extracted_at = excluded.extracted_at,
            invalidated_at = NULL,
            invalidation_reason = NULL
        """,
        rows,
    )
    conn.commit()


def invalidate_claims_for_document(conn, doc_id: str, reason: str) -> int:
    """Invalidate every active claim whose source_doc_ids contains doc_id.
    Because source_doc_ids is JSON TEXT there's no SQL array containment
    operator, so this fetches active claims and filters in Python, then
    updates matched rows. Returns the number of claims invalidated."""
    rows = conn.execute(
        "SELECT id, source_doc_ids FROM claims WHERE invalidated_at IS NULL"
    ).fetchall()
    matched_ids = [r["id"] for r in rows if doc_id in decode_list(r["source_doc_ids"])]
    if matched_ids:
        now = _now()
        conn.executemany(
            "UPDATE claims SET invalidated_at = ?, invalidation_reason = ? WHERE id = ?",
            [(now, reason, cid) for cid in matched_ids],
        )
        conn.commit()
    return len(matched_ids)


def get_active_claims(conn, account_id: str) -> list:
    """Return list[dict] of claims for an account where invalidated_at IS
    NULL. source_doc_ids is decoded back into a Python list on each row."""
    rows = conn.execute(
        "SELECT * FROM claims WHERE account_id = ? AND invalidated_at IS NULL "
        "ORDER BY extracted_at",
        (account_id,),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["source_doc_ids"] = decode_list(d["source_doc_ids"])
        result.append(d)
    return result


# ---------------------------------------------------------------------------
# account_state
# ---------------------------------------------------------------------------

def upsert_account_state(
    conn,
    account_id: str,
    derived_health: str = None,
    crm_label: str = None,
    mismatch: bool = False,
    mismatch_reason: str = None,
    stage: str = None,
    arr: float = None,
    renewal_date: str = None,
    payload: str = None,
    is_dirty: bool = False,
) -> None:
    """Insert or replace the single account_state row for account_id. Sets
    derived_at to now. `payload` should be a JSON-encoded string (the full
    derived account object matching the frontend contract), caller's
    responsibility to json.dumps it before passing in. is_dirty defaults to
    False since this is normally called right after a fresh derivation;
    pass is_dirty=True explicitly if the state is being seeded ahead of
    a synthesis pass."""
    conn.execute(
        """
        INSERT INTO account_state
            (account_id, derived_health, crm_label, mismatch, mismatch_reason,
             stage, arr, renewal_date, payload, derived_at, is_dirty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
            derived_health = excluded.derived_health,
            crm_label = excluded.crm_label,
            mismatch = excluded.mismatch,
            mismatch_reason = excluded.mismatch_reason,
            stage = excluded.stage,
            arr = excluded.arr,
            renewal_date = excluded.renewal_date,
            payload = excluded.payload,
            derived_at = excluded.derived_at,
            is_dirty = excluded.is_dirty
        """,
        (
            account_id,
            derived_health,
            crm_label,
            1 if mismatch else 0,
            mismatch_reason,
            stage,
            arr,
            renewal_date,
            payload,
            _now(),
            1 if is_dirty else 0,
        ),
    )
    conn.commit()


def mark_account_dirty(conn, account_id: str) -> None:
    """Flag an account as needing re-synthesis. If no account_state row
    exists yet, creates a minimal one with is_dirty=1 so get_dirty_accounts
    picks it up on the next sync tick."""
    cur = conn.execute(
        "UPDATE account_state SET is_dirty = 1 WHERE account_id = ?",
        (account_id,),
    )
    if cur.rowcount == 0:
        conn.execute(
            "INSERT INTO account_state (account_id, derived_at, is_dirty) VALUES (?, ?, 1)",
            (account_id, _now()),
        )
    conn.commit()


def get_dirty_accounts(conn) -> list:
    """Return list[str] of account_id where is_dirty = 1."""
    rows = conn.execute(
        "SELECT account_id FROM account_state WHERE is_dirty = 1"
    ).fetchall()
    return [r["account_id"] for r in rows]


def clear_dirty(conn, account_id: str) -> None:
    """Set is_dirty = 0 for account_id after a successful re-derivation."""
    conn.execute(
        "UPDATE account_state SET is_dirty = 0 WHERE account_id = ?",
        (account_id,),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# actions
# ---------------------------------------------------------------------------

def insert_action(
    conn,
    id: str,
    account_id: str,
    action: str,
    why: str,
    reason_codes: list,
    urgency: int,
    bucket: str,
    source_doc_ids: list,
    created_at: str = None,
) -> None:
    """Insert (or replace by id) a single generated action row. reason_codes
    and source_doc_ids are Python lists, encoded with encode_list before
    storage."""
    conn.execute(
        """
        INSERT INTO actions
            (id, account_id, action, why, reason_codes, urgency, bucket,
             source_doc_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            account_id = excluded.account_id,
            action = excluded.action,
            why = excluded.why,
            reason_codes = excluded.reason_codes,
            urgency = excluded.urgency,
            bucket = excluded.bucket,
            source_doc_ids = excluded.source_doc_ids,
            created_at = excluded.created_at
        """,
        (
            id,
            account_id,
            action,
            why,
            encode_list(reason_codes),
            urgency,
            bucket,
            encode_list(source_doc_ids),
            created_at or _now(),
        ),
    )
    conn.commit()


def get_actions(conn, account_id: str = None) -> list:
    """Return list[dict] of actions, optionally filtered to one account_id,
    ordered by urgency descending then created_at descending. reason_codes
    and source_doc_ids are decoded back into Python lists on each row."""
    if account_id is not None:
        rows = conn.execute(
            "SELECT * FROM actions WHERE account_id = ? "
            "ORDER BY urgency DESC, created_at DESC",
            (account_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM actions ORDER BY urgency DESC, created_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["reason_codes"] = decode_list(d["reason_codes"])
        d["source_doc_ids"] = decode_list(d["source_doc_ids"])
        result.append(d)
    return result


# ---------------------------------------------------------------------------
# change_log
# ---------------------------------------------------------------------------

def append_change_log(
    conn,
    account_id: str,
    type: str,
    description: str,
    consequence: str,
) -> int:
    """Append one change_log row. `type` should be one of: document_added,
    document_withdrawn, usage_updated, account_rederived, claim_invalidated.
    Returns the new row's integer id."""
    row = conn.execute(
        "INSERT INTO change_log (at, account_id, type, description, consequence) "
        "VALUES (?, ?, ?, ?, ?) RETURNING id",
        (_now(), account_id, type, _strip_em_dash(description), _strip_em_dash(consequence)),
    ).fetchone()
    conn.commit()
    return row["id"] if row else None


def get_change_log(conn, limit: int = 200) -> list:
    """Return the most recent `limit` change_log rows as list[dict], newest
    first."""
    rows = conn.execute(
        "SELECT * FROM change_log ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    connection = get_connection()
    tables = connection.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' ORDER BY table_name"
    ).fetchall()
    print(f"database_url configured: {'yes' if DATABASE_URL else 'no'}")
    print("tables:")
    for t in tables:
        print(f"  - {t['table_name']}")
    connection.close()
