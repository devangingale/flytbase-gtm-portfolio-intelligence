"""
SQLite storage layer for the FlytBase GTM Portfolio Intelligence System.

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

No ORM, plain sqlite3. Every connection uses row_factory = sqlite3.Row so
callers can do dict(row) on returned rows.

Array-typed columns (source_doc_ids, reason_codes) have no native SQLite
type, so they are stored as JSON-encoded TEXT via encode_list / decode_list
below. Every other module that touches these columns should use those two
helpers rather than json.dumps/json.loads directly, to keep encoding
consistent (empty/None both round-trip to []).

Usage:
    python backend/db.py     # create the db at DB_PATH and print table list
"""

import os
import json
import sqlite3
import pathlib
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DEFAULT_DB_PATH = str(pathlib.Path(__file__).resolve().parent.parent / "gtm.db")
DB_PATH = os.environ.get("DB_PATH", DEFAULT_DB_PATH)

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
    confidence REAL,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    """Encode a Python list (or None) into the JSON TEXT stored in SQLite."""
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
# Connection
# ---------------------------------------------------------------------------

def get_connection(db_path: str = None) -> sqlite3.Connection:
    """Open (creating if needed) the SQLite database and ensure the schema
    exists. Safe to call repeatedly, every call runs CREATE TABLE IF NOT
    EXISTS. Returns a connection with row_factory = sqlite3.Row and foreign
    keys / WAL not required for this workload, kept plain for simplicity."""
    path = db_path or DB_PATH
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# documents
# ---------------------------------------------------------------------------

def upsert_document(
    conn: sqlite3.Connection,
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


def mark_document_withdrawn(conn: sqlite3.Connection, doc_id: str, reason: str = None) -> None:
    """Mark a document as no longer present (deletion detection). Sets
    is_present=0 and withdrawn_at=now. `reason` is informational, callers
    are expected to also append_change_log(type="document_withdrawn", ...)
    separately since that call needs the account_id and consequence text."""
    conn.execute(
        "UPDATE documents SET is_present = 0, withdrawn_at = ? WHERE id = ?",
        (_now(), doc_id),
    )
    conn.commit()


def get_present_documents(conn: sqlite3.Connection, account_id: str) -> list:
    """Return list[dict] of documents currently is_present=1 for an account."""
    rows = conn.execute(
        "SELECT * FROM documents WHERE account_id = ? AND is_present = 1 ORDER BY doc_date",
        (account_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# claims
# ---------------------------------------------------------------------------

def insert_claims(conn: sqlite3.Connection, claims: list) -> None:
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


def invalidate_claims_for_document(conn: sqlite3.Connection, doc_id: str, reason: str) -> int:
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


def get_active_claims(conn: sqlite3.Connection, account_id: str) -> list:
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
    conn: sqlite3.Connection,
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


def mark_account_dirty(conn: sqlite3.Connection, account_id: str) -> None:
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


def get_dirty_accounts(conn: sqlite3.Connection) -> list:
    """Return list[str] of account_id where is_dirty = 1."""
    rows = conn.execute(
        "SELECT account_id FROM account_state WHERE is_dirty = 1"
    ).fetchall()
    return [r["account_id"] for r in rows]


def clear_dirty(conn: sqlite3.Connection, account_id: str) -> None:
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
    conn: sqlite3.Connection,
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


def get_actions(conn: sqlite3.Connection, account_id: str = None) -> list:
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
    conn: sqlite3.Connection,
    account_id: str,
    type: str,
    description: str,
    consequence: str,
) -> int:
    """Append one change_log row. `type` should be one of: document_added,
    document_withdrawn, usage_updated, account_rederived, claim_invalidated.
    Returns the new row's integer id."""
    cur = conn.execute(
        "INSERT INTO change_log (at, account_id, type, description, consequence) "
        "VALUES (?, ?, ?, ?, ?)",
        (_now(), account_id, type, _strip_em_dash(description), _strip_em_dash(consequence)),
    )
    conn.commit()
    return cur.lastrowid


def get_change_log(conn: sqlite3.Connection, limit: int = 200) -> list:
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
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    print(f"db path: {DB_PATH}")
    print("tables:")
    for t in tables:
        print(f"  - {t['name']}")
    connection.close()
