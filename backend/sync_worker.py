"""
Sync worker: the pull-and-diff loop from Master PRD section 5 step [1].

This is the single hardest requirement in the PRD (section 2): the system must
notice, on its own, when a source document is added, changed, or withdrawn,
without a human re-running anything. Content-hash diffing makes unchanged
documents a cheap no-op; deletion detection is the differentiator (most
competing builds handle additions and miss deletions).

Exposed functions:
    run_sync_cycle(db_conn, mcp_client=None) -> set[str]
        One full pull-and-diff pass across all accounts. Returns the set of
        account ids marked dirty this cycle (a _SyncResult, a set subclass
        that also carries .changed_documents / .docs_added / .docs_changed /
        .docs_withdrawn / .usage_updates for callers that want cycle stats).
        Safe to call synchronously (used for the initial pull before the
        scheduler starts, and for a manual "force sync now").

    start_scheduler(db_conn, extraction_fn, synthesis_fn, interval_seconds=None) -> BackgroundScheduler
        Wires run_sync_cycle into APScheduler on a fixed interval (env
        SYNC_INTERVAL_SECONDS, default 300). After each cycle, calls
        extraction_fn(document_row) for every added/changed document
        belonging to a dirty account (never for unchanged documents, this is
        the content_hash cache requirement), then synthesis_fn(account_id)
        once per dirty account (never per document), then clears the dirty
        flag and logs account_rederived.

extraction_fn and synthesis_fn are injected callables so this module has no
direct dependency on the LLM client modules (independently testable, no
import cycles).
"""

import os
import sys
import json
import hashlib
import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mcp_client import McpClient  # noqa: E402
from backend import db  # noqa: E402

logger = logging.getLogger("sync_worker")

DEFAULT_INTERVAL_SECONDS = int(os.environ.get("SYNC_INTERVAL_SECONDS", "300"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _unwrap_json(result):
    """Unwrap an MCP tool call result's content[0].text and json.loads it."""
    if result is None:
        return None
    content = result.get("content") if isinstance(result, dict) else None
    if not content:
        return None
    text = content[0].get("text", "")
    if not text:
        return None
    return json.loads(text)


def _unwrap_text(result):
    """Unwrap an MCP tool call result's content[0].text as raw markdown."""
    if result is None:
        return ""
    content = result.get("content") if isinstance(result, dict) else None
    if not content:
        return ""
    return content[0].get("text", "")


def _doc_id(account_id: str, file_name: str) -> str:
    return f"{account_id}::{file_name}"


def _usage_doc_id(account_id: str) -> str:
    return f"{account_id}::usage"


def _get_document_row(conn, doc_id: str):
    """Single-document lookup by id. db.py exposes get_present_documents
    (per-account, is_present=1 only) but no single-row getter, so this
    queries directly; needed here to check a document's stored content_hash
    (present or withdrawn) before deciding add/unchanged/changed."""
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    return dict(row) if row else None


class _SyncResult(set):
    """A plain set of dirty account ids, with extra cycle stats attached as
    attributes so callers that only care about "which accounts changed" can
    treat this as a normal set, while start_scheduler and the __main__ smoke
    test can read the counts.
    """
    pass


def run_sync_cycle(db_conn, mcp_client=None):
    """One full pull-and-diff pass across the whole portfolio.

    For each of the 14 accounts: pulls the current document list, hashes
    each document's raw content, diffs against the documents table (added /
    unchanged / changed), detects withdrawn documents (present before,
    absent now), invalidates claims sourced from changed or withdrawn
    documents, pulls usage as a synthetic pseudo-document, and marks
    accounts dirty on any change.

    Returns a _SyncResult (set of dirty account ids) with
    .changed_documents (list of document row dicts, newly added or changed
    content this cycle only, exactly the set that needs (re-)extraction),
    .docs_added, .docs_changed, .docs_withdrawn, .usage_updates.
    """
    owns_client = mcp_client is None
    client = mcp_client or McpClient()
    if owns_client:
        client.initialize()

    dirty_accounts = _SyncResult()
    changed_documents = []
    docs_added = 0
    docs_changed = 0
    docs_withdrawn = 0
    usage_updates = 0

    try:
        accounts_result = client.call_tool("list_accounts")
        accounts = _unwrap_json(accounts_result) or []

        for account in accounts:
            account_id = account.get("id") or account.get("accountId")
            if not account_id:
                continue

            docs_result = client.call_tool("list_account_documents", {"id": account_id})
            current_docs = _unwrap_json(docs_result) or []
            current_files = {d["file"] for d in current_docs if "file" in d}

            # snapshot of what was present before this cycle, for withdrawal detection
            previously_present = db.get_present_documents(db_conn, account_id)

            for doc_meta in current_docs:
                file_name = doc_meta.get("file")
                if not file_name:
                    continue
                doc_id = _doc_id(account_id, file_name)
                doc_type = doc_meta.get("type", "document")
                title = doc_meta.get("title")
                doc_date = doc_meta.get("date")

                content_result = client.call_tool(
                    "get_account_document", {"id": account_id, "file": file_name}
                )
                raw_text = _unwrap_text(content_result)
                content_hash = _sha256(raw_text)

                existing = _get_document_row(db_conn, doc_id)

                if existing is None:
                    # new document
                    db.upsert_document(
                        db_conn, doc_id, account_id, doc_type, title, doc_date,
                        raw_text, content_hash,
                    )
                    db.append_change_log(
                        db_conn, account_id, "document_added",
                        f"New document added: {title or file_name} ({doc_type})",
                        "1 document added, pending extraction",
                    )
                    db.mark_account_dirty(db_conn, account_id)
                    dirty_accounts.add(account_id)
                    docs_added += 1
                    changed_documents.append(_get_document_row(db_conn, doc_id))

                elif existing["content_hash"] != content_hash:
                    # changed content: update, invalidate sourced claims, re-derive
                    db.upsert_document(
                        db_conn, doc_id, account_id, doc_type, title, doc_date,
                        raw_text, content_hash,
                    )
                    invalidated_count = db.invalidate_claims_for_document(
                        db_conn, doc_id, "source document content changed"
                    )
                    db.append_change_log(
                        db_conn, account_id, "claim_invalidated",
                        f"Document content changed: {title or file_name} ({doc_type})",
                        f"{invalidated_count} claims invalidated, pending re-extraction",
                    )
                    db.mark_account_dirty(db_conn, account_id)
                    dirty_accounts.add(account_id)
                    docs_changed += 1
                    changed_documents.append(_get_document_row(db_conn, doc_id))

                else:
                    # unchanged: cheap no-op, never re-extract
                    pass

            # deletion detection: anything present before but absent from the
            # current listing has been withdrawn at the source. The usage
            # pseudo-document is excluded here, it is never returned by
            # list_account_documents so it would otherwise look withdrawn on
            # every cycle; usage staleness is handled separately below by
            # comparing its own content hash.
            for row in previously_present:
                if row.get("type") == "usage":
                    continue
                file_name_prev = row.get("id", "").split("::", 1)[-1]
                if file_name_prev not in current_files:
                    doc_id = row["id"]
                    db.mark_document_withdrawn(db_conn, doc_id, reason="source document withdrawn")
                    invalidated_count = db.invalidate_claims_for_document(
                        db_conn, doc_id, "source document withdrawn"
                    )
                    db.append_change_log(
                        db_conn, account_id, "document_withdrawn",
                        f"Document withdrawn: {row.get('title') or file_name_prev} ({row.get('type')})",
                        f"{invalidated_count} claims invalidated",
                    )
                    db.mark_account_dirty(db_conn, account_id)
                    dirty_accounts.add(account_id)
                    docs_withdrawn += 1

            # usage as a synthetic per-account pseudo-document. Detectors are
            # pure Python (PRD section 5 step [4]), so usage updates never
            # trigger extraction, only mark the account dirty for synthesis.
            usage_result = client.call_tool("get_account_usage", {"id": account_id})
            usage_series = _unwrap_json(usage_result)
            if usage_series is None:
                usage_series = []
            usage_text = json.dumps(usage_series, sort_keys=True)
            usage_hash = _sha256(usage_text)
            usage_id = _usage_doc_id(account_id)
            existing_usage = _get_document_row(db_conn, usage_id)

            if existing_usage is None or existing_usage["content_hash"] != usage_hash:
                db.upsert_document(
                    db_conn, usage_id, account_id, "usage", "Flight Usage", None,
                    usage_text, usage_hash,
                )
                db.append_change_log(
                    db_conn, account_id, "usage_updated",
                    f"Usage data updated ({len(usage_series)} months in series)",
                    "usage trend detector will re-run on next synthesis",
                )
                db.mark_account_dirty(db_conn, account_id)
                dirty_accounts.add(account_id)
                usage_updates += 1

    finally:
        if owns_client:
            client.close()

    logger.info(
        "sync cycle complete: accounts_touched=%d docs_added=%d docs_changed=%d "
        "docs_withdrawn=%d usage_updates=%d",
        len(dirty_accounts), docs_added, docs_changed, docs_withdrawn, usage_updates,
    )

    dirty_accounts.changed_documents = changed_documents
    dirty_accounts.docs_added = docs_added
    dirty_accounts.docs_changed = docs_changed
    dirty_accounts.docs_withdrawn = docs_withdrawn
    dirty_accounts.usage_updates = usage_updates
    return dirty_accounts


def _run_cycle_and_dispatch(db_conn, extraction_fn, synthesis_fn):
    """Run one cycle, then dispatch extraction (changed/added docs only) and
    synthesis (dirty accounts only, once each), then clear dirty flags.
    """
    dirty_accounts = run_sync_cycle(db_conn)

    for doc_row in dirty_accounts.changed_documents:
        if doc_row is None:
            continue
        try:
            claims = extraction_fn(doc_row)
            # extraction_fn (backend.extraction.extract_claims) is a pure
            # "text in, claims out" function per its own docstring, it does
            # not persist anything itself. Persisting the returned claims is
            # the caller's job, done here so the scheduled path actually
            # writes claims to the claims table instead of discarding them.
            if claims:
                db.insert_claims(db_conn, claims)
        except Exception:
            logger.exception("extraction_fn failed for document %s", doc_row.get("id"))

    for account_id in dirty_accounts:
        try:
            synthesis_fn(account_id)
        except Exception:
            logger.exception("synthesis_fn failed for account %s", account_id)
            continue
        db.clear_dirty(db_conn, account_id)
        db.append_change_log(
            db_conn, account_id, "account_rederived",
            "Account re-derived after sync",
            "health, risks, opportunities, and actions refreshed",
        )
    return dirty_accounts


def _job_db_path(db_conn):
    """Resolve the on-disk file backing a sqlite3.Connection, via PRAGMA
    database_list (works for any connection regardless of how it was
    opened). Falls back to db.DB_PATH if introspection fails (e.g. an
    in-memory ":memory:" connection has no file, not expected in practice
    for this app but kept safe).
    """
    try:
        row = db_conn.execute("PRAGMA database_list").fetchone()
        if row and row["file"]:
            return row["file"]
    except Exception:
        pass
    return db.DB_PATH


def start_scheduler(db_conn, extraction_fn, synthesis_fn, interval_seconds=None):
    """Start the background sync loop on a fixed interval.

    interval_seconds defaults to env SYNC_INTERVAL_SECONDS (300s / 5 min per
    PRD section 5), overridable per call for local testing with a short
    interval. Returns the running BackgroundScheduler so the caller can
    shut it down (scheduler.shutdown()).

    APScheduler's BackgroundScheduler runs jobs on its own worker thread,
    but a sqlite3.Connection is only usable on the thread that created it
    (SQLite raises ProgrammingError otherwise). Rather than requiring every
    caller to open db_conn with check_same_thread=False, each scheduled run
    opens its own short-lived connection to the same database file and
    closes it when the cycle finishes; db_conn itself is only used here to
    resolve that file path, and remains safe for the caller's own thread
    (e.g. FastAPI request handlers) to keep using independently.
    """
    interval = interval_seconds if interval_seconds is not None else DEFAULT_INTERVAL_SECONDS
    db_path = _job_db_path(db_conn)

    def _tick():
        job_conn = db.get_connection(db_path)
        try:
            _run_cycle_and_dispatch(job_conn, extraction_fn, synthesis_fn)
        finally:
            job_conn.close()

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _tick,
        "interval",
        seconds=interval,
        id="gtm_sync_cycle",
        next_run_time=datetime.now(),  # fire an initial run immediately on start
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("scheduler started: interval_seconds=%d db_path=%s", interval, db_path)
    return scheduler


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    conn = db.get_connection()

    result = run_sync_cycle(conn)

    print("sync cycle summary")
    print(f"  accounts touched (dirty): {len(result)}")
    if result:
        print(f"    -> {sorted(result)}")
    print(f"  documents added:     {result.docs_added}")
    print(f"  documents changed:   {result.docs_changed}")
    print(f"  documents withdrawn: {result.docs_withdrawn}")
    print(f"  usage updates:       {result.usage_updates}")

    conn.close()
