"""
FastAPI application for the FlytBase GTM Portfolio Intelligence System.

Serves GET /api/portfolio from the local SQLite store only (never a live MCP
call on page load, per Master PRD section 4). On startup it ensures the schema
exists, runs one synchronous sync cycle so there is real data before the first
request, then starts the APScheduler background loop for the 5 minute sync.

This module is intentionally defensive about its sibling modules (backend.db,
backend.detectors, backend.sync_worker, backend.extraction, backend.synthesis)
because they are being written in parallel. If one of them is not importable
yet, this file still loads and the app still boots and serves /api/health, so
a partially finished backend never hard-crashes the process (Master PRD rule:
"if something does not work, say so", not "let the whole app go down").
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

# Guarantee the repo root is on sys.path regardless of invocation style, so
# `from backend import ...` resolves whether this file is launched as
# `python backend/main.py` (script dir on path, not repo root) or
# `python -m backend.main` / `uvicorn backend.main:app` (repo root already on
# path). Mirrors the same guard already present in backend/sync_worker.py and
# backend/pipeline.py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("gtm.main")

# ---------------------------------------------------------------------------
# Sibling module imports.
#
# Names imported here, matching each module's real exported signature:
#   backend.db           get_connection(db_path) -> Connection (creates schema
#                         itself, no separate init step), get_change_log(conn,
#                         limit=200), get_actions(conn, account_id=None),
#                         decode_list(text) -> list
#   backend.detectors    usage_trend(usage_series), renewal_proximity(
#                         reference_date, renewal_date). Imported for the
#                         contract even though this module reads their
#                         already-computed results back out of
#                         account_state.payload rather than calling them
#                         itself: detectors run during sync/synthesis, not at
#                         request time.
#   backend.sync_worker  run_sync_cycle(db_conn, mcp_client=None) -> set of
#                         dirty account ids, start_scheduler(db_conn,
#                         extraction_fn, synthesis_fn, interval_seconds=None)
#   backend.extraction   extract_claims(document) -> list[claim dict]
#   backend.synthesis    synthesize_account(account_row, claims,
#                         detector_results, documents) -> dict
#
# Each group is imported independently and defensively: a missing or broken
# module logs a clear error and leaves its names as None rather than raising
# at import time, so the API can still start and serve /api/health while the
# rest of the pipeline is still being written by other agents.
# ---------------------------------------------------------------------------

get_connection = None
get_change_log = None
get_actions = None
decode_list = None
insert_claims = None
clear_dirty = None
append_change_log = None
db = None
try:
    from backend import db  # type: ignore
    from backend.db import (  # type: ignore
        get_connection, get_change_log, get_actions, decode_list,
        insert_claims, clear_dirty, append_change_log,
    )
except Exception as exc:  # noqa: BLE001 - deliberately broad, see module docstring
    logger.error("backend.db not fully importable yet: %s", exc)

usage_trend = None
renewal_proximity = None
try:
    from backend.detectors import usage_trend, renewal_proximity  # type: ignore
except Exception as exc:  # noqa: BLE001
    logger.warning("backend.detectors not fully importable yet: %s", exc)

run_sync_cycle = None
start_scheduler = None
try:
    from backend.sync_worker import run_sync_cycle, start_scheduler  # type: ignore
except Exception as exc:  # noqa: BLE001
    logger.warning("backend.sync_worker not fully importable yet: %s", exc)

extract_claims = None
try:
    from backend.extraction import extract_claims  # type: ignore
except Exception as exc:  # noqa: BLE001
    logger.warning("backend.extraction not fully importable yet: %s", exc)

synthesize_account = None
try:
    from backend.synthesis import synthesize_account  # type: ignore
except Exception as exc:  # noqa: BLE001
    logger.warning("backend.synthesis not fully importable yet: %s", exc)

# backend.pipeline.derive_account(conn, account_id, account_row) is the glue
# that actually runs detectors + synthesis and writes account_state/actions
# for one account (Master PRD section 5 steps [4]-[6]). It is what gets
# wired in as the single argument synthesis_fn(account_id) callable that
# backend.sync_worker.start_scheduler and the initial sync below expect,
# since backend.synthesis.synthesize_account itself takes four arguments
# (account_row, claims, detector_results, documents), not just an account id.
make_synthesis_fn = None
try:
    from backend.pipeline import make_synthesis_fn  # type: ignore
except Exception as exc:  # noqa: BLE001
    logger.warning("backend.pipeline not fully importable yet: %s", exc)


DB_PATH = os.environ.get("GTM_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "gtm.db"))

# Health bucket mapping used consistently for totals rollup.
HEALTHY_BUCKET = {"healthy", "warm"}
AT_RISK_BUCKET = {"at_risk"}
LOST_BUCKET = {"lost", "churned"}


# ---------------------------------------------------------------------------
# In-process state used to answer /api/health and to report sync status in
# meta even if a given sync cycle throws.
# ---------------------------------------------------------------------------
_app_state = {
    "last_sync_at": None,
    "sync_status": "unknown",
    "last_sync_error": None,
}


def _run_initial_sync_safely(conn):
    """Run one synchronous pull-and-diff pass before the first request is
    served, so /api/portfolio never answers from an empty store.

    This calls run_sync_cycle(db_conn) directly (its real signature per
    backend.sync_worker: one positional db_conn, no extraction/synthesis
    callables, it only marks accounts dirty and returns their ids). Dispatch
    of extraction and synthesis for whatever came back dirty is done here.

    Synthesis dispatch goes through backend.pipeline.derive_account (via the
    make_synthesis_fn() closure), not backend.synthesis.synthesize_account
    directly: synthesize_account takes four required arguments (account_row,
    claims, detector_results, documents), so a bare synthesize_account(account_id)
    call would throw TypeError on every dirty account. pipeline.derive_account
    is the module that actually assembles those four arguments, runs the
    detectors, calls synthesis, and writes account_state + actions.

    Never lets an exception escape: Master PRD rule 3 and this task's
    requirement 6, a single failed sync cycle must not crash the app or stop
    it serving the last good state.
    """
    if run_sync_cycle is None:
        logger.error("run_sync_cycle is not available (backend.sync_worker failed to import), skipping initial sync")
        _app_state["sync_status"] = "error"
        _app_state["last_sync_error"] = "sync_worker module not available"
        return

    try:
        logger.info("Starting initial synchronous sync cycle")
        dirty_accounts = run_sync_cycle(conn)

        changed_documents = getattr(dirty_accounts, "changed_documents", [])
        if extract_claims is not None:
            for doc_row in changed_documents:
                if not doc_row:
                    continue
                try:
                    claims = extract_claims(doc_row)
                    if claims:
                        db.insert_claims(conn, claims)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("extract_claims failed for document %s: %s", doc_row.get("id"), exc)
        else:
            logger.warning("extraction.extract_claims not available, skipping extraction for %d changed document(s)", len(changed_documents))

        if make_synthesis_fn is not None:
            synthesis_fn = make_synthesis_fn()
            for account_id in dirty_accounts:
                try:
                    synthesis_fn(account_id)
                    if clear_dirty is not None:
                        clear_dirty(conn, account_id)
                    if append_change_log is not None:
                        append_change_log(
                            conn, account_id, "account_rederived",
                            "Account re-derived after sync",
                            "health, risks, opportunities, and actions refreshed",
                        )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("synthesis failed for account %s: %s", account_id, exc)
        else:
            logger.warning("backend.pipeline.make_synthesis_fn not available, skipping synthesis for %d dirty account(s)", len(list(dirty_accounts)))

        _app_state["last_sync_at"] = datetime.now(timezone.utc).isoformat()
        _app_state["sync_status"] = "ok"
        _app_state["last_sync_error"] = None
        logger.info("Initial sync cycle completed, %d account(s) dirty", len(list(dirty_accounts)))
    except Exception as exc:  # noqa: BLE001 - a sync cycle must never take the app down
        logger.exception("Initial sync cycle failed: %s", exc)
        _app_state["sync_status"] = "error"
        _app_state["last_sync_error"] = str(exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup: opening database connection at %s", DB_PATH)

    conn = None
    try:
        if get_connection is None:
            raise RuntimeError("backend.db.get_connection is not available")
        # get_connection(db_path) creates the schema itself (CREATE TABLE IF
        # NOT EXISTS on every call), there is no separate init step to run.
        conn = get_connection(DB_PATH)
        app.state.db_conn = conn
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to open database on startup: %s", exc)
        app.state.db_conn = conn  # may be None, endpoints handle that

    # Run one synchronous sync cycle so there is real data before the first
    # request (per requirement 5). Never let this take the process down.
    if conn is not None:
        _run_initial_sync_safely(conn)
    else:
        logger.error("No database connection, skipping initial sync")
        _app_state["sync_status"] = "error"
        _app_state["last_sync_error"] = "no database connection"

    # Start the background scheduler for the recurring 5 minute sync. Wired
    # to extraction.extract_claims and synthesis.synthesize_account per the
    # real backend.sync_worker.start_scheduler(db_conn, extraction_fn,
    # synthesis_fn, interval_seconds=None) signature.
    scheduler = None
    try:
        if start_scheduler is not None and conn is not None and make_synthesis_fn is not None:
            # make_synthesis_fn() returns a synthesis_fn(account_id) closure
            # backed by backend.pipeline.derive_account, matching the single
            # argument signature backend.sync_worker.start_scheduler calls,
            # rather than passing synthesize_account directly (which needs
            # four arguments and would throw on every scheduled tick).
            scheduler = start_scheduler(conn, extract_claims, make_synthesis_fn())
            app.state.scheduler = scheduler
            logger.info("Background sync scheduler started")
        else:
            logger.error("backend.sync_worker.start_scheduler, backend.pipeline.make_synthesis_fn, or db connection not available, no recurring sync will run")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to start background scheduler: %s", exc)

    yield

    logger.info("Application shutdown")
    try:
        if scheduler is not None and hasattr(scheduler, "shutdown"):
            scheduler.shutdown(wait=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error shutting down scheduler: %s", exc)
    try:
        if conn is not None:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error closing database connection: %s", exc)


app = FastAPI(title="FlytBase GTM Portfolio Intelligence API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Response assembly
# ---------------------------------------------------------------------------

def _row_get(row, key, default=None):
    """Access a value from either a sqlite3.Row or a plain dict, uniformly."""
    try:
        value = row[key]
        return value if value is not None else default
    except (IndexError, KeyError):
        return default


def _health_bucket(derived_health):
    if derived_health in HEALTHY_BUCKET:
        return "secure"
    if derived_health in AT_RISK_BUCKET:
        return "at_risk"
    if derived_health in LOST_BUCKET:
        return "lost"
    return "at_risk"


def build_portfolio_response(db_conn) -> dict:
    """Assemble the exact fixture contract shape from real stored data.

    Reads account_state, actions, documents, and change_log rows. Never
    invents or hardcodes values, per Master PRD rule 3. Deterministic totals
    (sums, percentages, forecast) are computed here in plain Python, per rule
    4, never via an LLM call.
    """
    if db_conn is None:
        raise RuntimeError("no database connection available")

    import json as _json

    cur = db_conn.cursor()

    # ---- account_state ---------------------------------------------------
    cur.execute("SELECT * FROM account_state")
    state_rows = cur.fetchall()

    accounts = []
    arr_secure = 0
    arr_at_risk = 0
    arr_lost = 0
    arr_total = 0

    for row in state_rows:
        payload_raw = _row_get(row, "payload")
        payload = {}
        if payload_raw:
            try:
                payload = _json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
            except (TypeError, ValueError):
                logger.warning("Could not parse account_state.payload for account_id=%s", _row_get(row, "account_id"))
                payload = {}

        account_id = _row_get(row, "account_id")
        derived_health = _row_get(row, "derived_health")
        arr = _row_get(row, "arr", 0) or 0
        arr_total += arr

        bucket = _health_bucket(derived_health)
        if bucket == "secure":
            arr_secure += arr
        elif bucket == "at_risk":
            arr_at_risk += arr
        else:
            arr_lost += arr

        account_obj = {
            "id": account_id,
            "name": payload.get("name"),
            "stage": _row_get(row, "stage") or payload.get("stage"),
            "arr": arr,
            "renewal_date": _row_get(row, "renewal_date"),
            "health": {
                "derived": derived_health,
                "crm_label": _row_get(row, "crm_label"),
                "mismatch": bool(_row_get(row, "mismatch", False)),
                "mismatch_reason": _row_get(row, "mismatch_reason"),
            },
            "contacts": payload.get("contacts", []),
            "usage": payload.get("usage"),  # None (-> JSON null) when not actively flying
            "risks": payload.get("risks", []),
            "opportunities": payload.get("opportunities", []),
            "claims": payload.get("claims", []),
            "winback": payload.get("winback"),  # None (-> JSON null) for non-churned accounts
        }
        accounts.append(account_obj)

    # ---- deterministic totals ---------------------------------------------
    # forecast = secure ARR + 45% of at-risk ARR. Plain arithmetic, no LLM.
    forecast = arr_secure + 0.45 * arr_at_risk
    forecast_basis = (
        "Secure ARR plus 45 percent of at risk ARR, computed from derived health "
        "buckets over %d accounts, refreshed each sync cycle." % len(accounts)
    )

    totals = {
        "arr_total": arr_total,
        "arr_secure": arr_secure,
        "arr_at_risk": arr_at_risk,
        "arr_lost": arr_lost,
        "forecast": round(forecast, 2),
        "forecast_basis": forecast_basis,
    }

    # ---- actions --------------------------------------------------------
    # Prefer backend.db.get_actions, which already decodes reason_codes and
    # source_doc_ids via decode_list and orders by urgency descending.
    actions = []
    if get_actions is not None:
        try:
            for a in get_actions(db_conn):
                actions.append({
                    "id": a.get("id"),
                    "account_id": a.get("account_id"),
                    "action": a.get("action"),
                    "why": a.get("why"),
                    "reason_codes": a.get("reason_codes") or [],
                    "urgency": a.get("urgency"),
                    "bucket": a.get("bucket"),
                    "evidence": a.get("source_doc_ids") or [],
                })
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_actions failed, falling back to direct query: %s", exc)
            actions = []

    if not actions:
        cur.execute("SELECT * FROM actions ORDER BY urgency DESC")
        action_rows = cur.fetchall()
        for row in action_rows:
            source_doc_ids = decode_list(_row_get(row, "source_doc_ids")) if decode_list else []
            reason_codes = decode_list(_row_get(row, "reason_codes")) if decode_list else []
            actions.append({
                "id": _row_get(row, "id"),
                "account_id": _row_get(row, "account_id"),
                "action": _row_get(row, "action"),
                "why": _row_get(row, "why"),
                "reason_codes": reason_codes,
                "urgency": _row_get(row, "urgency"),
                "bucket": _row_get(row, "bucket"),
                "evidence": source_doc_ids,
            })

    # ---- documents --------------------------------------------------------
    # raw_payload is the document's plain markdown/text content (not JSON),
    # so the excerpt is a plain truncated slice of it.
    cur.execute("SELECT * FROM documents ORDER BY doc_date DESC")
    doc_rows = cur.fetchall()
    documents = []
    for row in doc_rows:
        is_present = _row_get(row, "is_present", True)
        status = "active" if is_present else "withdrawn"
        raw_payload = _row_get(row, "raw_payload")
        excerpt = raw_payload.strip()[:280] if isinstance(raw_payload, str) and raw_payload.strip() else None

        documents.append({
            "id": _row_get(row, "id"),
            "account_id": _row_get(row, "account_id"),
            "type": _row_get(row, "type"),
            "title": _row_get(row, "title"),
            "date": _row_get(row, "doc_date"),
            "excerpt": excerpt,
            "status": status,
        })

    # ---- change_feed ------------------------------------------------------
    change_feed = []
    if get_change_log is not None:
        try:
            change_feed = get_change_log(db_conn)
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_change_log failed, falling back to direct query: %s", exc)
            change_feed = []

    if not change_feed:
        cur.execute("SELECT * FROM change_log ORDER BY at DESC")
        log_rows = cur.fetchall()
        change_feed = [
            {
                "id": _row_get(row, "id"),
                "at": _row_get(row, "at"),
                "account_id": _row_get(row, "account_id"),
                "type": _row_get(row, "type"),
                "description": _row_get(row, "description"),
                "consequence": _row_get(row, "consequence"),
            }
            for row in log_rows
        ]

    # ---- meta ---------------------------------------------------------------
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "last_sync_at": _app_state["last_sync_at"],
        "sync_status": _app_state["sync_status"],
        "source_doc_count": len(documents),
    }

    return {
        "meta": meta,
        "totals": totals,
        "accounts": accounts,
        "actions": actions,
        "documents": documents,
        "change_feed": change_feed,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/portfolio")
def get_portfolio():
    """Read-only, served entirely from the local store. Never calls MCP live.

    Opens its own short-lived connection to DB_PATH rather than reusing the
    long-lived startup connection stored on app.state. Sync FastAPI route
    functions run in a worker thread pool, and sqlite3 connections are
    thread-affine by default (check_same_thread=True), so sharing one
    connection across request threads raises "SQLite objects created in a
    thread can only be used in that same thread". A fresh per-request
    connection avoids that while still only ever reading the local file
    based store, never MCP.
    """
    if get_connection is None:
        return JSONResponse(
            status_code=503,
            content={"error": "portfolio_unavailable", "detail": "backend.db.get_connection is not available"},
        )
    try:
        request_conn = get_connection(DB_PATH)
        try:
            payload = build_portfolio_response(request_conn)
        finally:
            request_conn.close()
        return JSONResponse(content=payload)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to build portfolio response: %s", exc)
        return JSONResponse(
            status_code=503,
            content={
                "error": "portfolio_unavailable",
                "detail": str(exc),
            },
        )


@app.get("/api/health")
def get_health():
    return {
        "status": "ok",
        "last_sync_at": _app_state["last_sync_at"],
        "sync_status": _app_state["sync_status"],
        "last_sync_error": _app_state["last_sync_error"],
    }


@app.post("/api/sync")
def force_sync(x_sync_secret: str = Header(default=None)):
    """Manual sync trigger for the Render cron job, a redundant safety net
    alongside the in-process APScheduler loop started at app startup (see
    lifespan()). Runs the exact same _run_initial_sync_safely(conn) path the
    scheduler uses, so this is not a second implementation to keep in sync,
    just an extra call to the one that already exists.

    Gated by a shared secret (env SYNC_SECRET) rather than left open, since
    this triggers real MCP and NIM calls. If SYNC_SECRET is unset, the
    endpoint is disabled (503) rather than silently open.
    """
    expected_secret = os.environ.get("SYNC_SECRET")
    if not expected_secret:
        return JSONResponse(
            status_code=503,
            content={"error": "sync_disabled", "detail": "SYNC_SECRET is not configured"},
        )
    if x_sync_secret != expected_secret:
        return JSONResponse(status_code=401, content={"error": "unauthorized"})

    if get_connection is None:
        return JSONResponse(
            status_code=503,
            content={"error": "sync_unavailable", "detail": "backend.db.get_connection is not available"},
        )
    conn = get_connection(DB_PATH)
    try:
        _run_initial_sync_safely(conn)
    finally:
        conn.close()
    return {
        "status": _app_state["sync_status"],
        "last_sync_at": _app_state["last_sync_at"],
        "last_sync_error": _app_state["last_sync_error"],
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    # Pass the already-loaded `app` object directly rather than the
    # "backend.main:app" import string. With reload=False uvicorn resolves an
    # import-string target via importlib in this same process, and when this
    # file is launched directly (`python backend/main.py`), sys.path[0] is
    # backend/ itself, not the repo root, so `import backend.main` fails with
    # ModuleNotFoundError even though this module already loaded fine as
    # __main__. Passing the object sidesteps the re-import entirely, so both
    # `python backend/main.py` and `python -m backend.main` work.
    uvicorn.run(app, host="0.0.0.0", port=port)
