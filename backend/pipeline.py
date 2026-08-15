"""
Portfolio pass: the glue that step [4] (detectors) and step [5] (synthesis) in
Master PRD section 5 need but that no single sibling module owns end to end.

Given one account id, this module:
  1. loads the account's raw CRM metadata (from the cached documents/claims,
     never a live MCP call, per Master PRD section 4),
  2. loads active claims and present documents for the account,
  3. runs the pure Python detectors (backend.detectors) over usage, contacts,
     escalations, champion status, and CRM label,
  4. derives `contacts` and `renewal_date` from claims heuristically, since
     the MCP source has no structured field for either (they live inside
     unstructured markdown and only reach the system via extracted claims),
  5. calls backend.synthesis.synthesize_account(account_row, claims,
     detector_results, documents) with its real four argument signature,
  6. writes the account_state row (payload = the exact per account object
     shape the frozen fixture expects) and (re)generates that account's
     ranked next actions.

This is intentionally the only module that knows the full fixture shape for
one account. backend.main assembles the portfolio level object (totals,
documents, change_feed) by reading account_state.payload back out, per
account, unchanged.

Usage:
    python backend/pipeline.py <account_id>   # smoke test against real MCP + NIM
"""

import os
import re
import sys
import json
import logging
import uuid
from datetime import datetime, timezone, date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import db  # noqa: E402
from backend import detectors  # noqa: E402
from backend.synthesis import synthesize_account  # noqa: E402

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger("pipeline")

# CRM category (from list_accounts/get_account "category") -> fixture stage.
# The fixture uses lifecycle stage values (active_customer, churned, prospect).
# Mapping chosen so every category that is a live paying relationship reads as
# active_customer, pre-sale reads as prospect, and churned stays churned.
# Documented in DECISIONS.md.
CATEGORY_TO_STAGE = {
    "pre-sale": "prospect",
    "newly-sold-onboarding": "active_customer",
    "established": "active_customer",
    "renewal-focused": "active_customer",
    "churned": "churned",
}

CHAMPION_FIELD_NAMES = {"champion_identity", "champion", "champion_name"}
RENEWAL_FIELD_NAMES = {"renewal_timeline", "renewal_date", "renewal"}

_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def _account_stage(category: str) -> str:
    return CATEGORY_TO_STAGE.get((category or "").strip().lower(), "active_customer")


def _extract_renewal_date(claims: list) -> str | None:
    """Pull an ISO date out of any renewal timeline claim's value text. Claims
    are free text from the LLM extraction step, not structured, so this is a
    best effort regex scan, not a guarantee. Returns None honestly if no date
    is found rather than fabricating one."""
    for c in claims:
        if (c.get("field") or "").lower() not in RENEWAL_FIELD_NAMES:
            continue
        match = _DATE_RE.search(c.get("value") or "")
        if match:
            return match.group(1)
    return None


def _extract_contacts(claims: list) -> list:
    """Build the fixture's `contacts` list from champion/contact related
    claims. Only champion identity claims reliably appear in this dataset, so
    each becomes one contact entry with role=champion and no last_contact_at
    (unknown, left null rather than invented) unless a claim field named
    contact_status supplies one. Never fabricates a name that is not present
    in a claim value."""
    contacts = []
    seen_names = set()
    for c in claims:
        field = (c.get("field") or "").lower()
        if field not in CHAMPION_FIELD_NAMES:
            continue
        value = (c.get("value") or "").strip()
        if not value or value in seen_names:
            continue
        seen_names.add(value)
        name = value.split(",")[0].strip()
        title = value.split(",", 1)[1].strip() if "," in value else None
        contacts.append({
            "name": name,
            "title": title,
            "role": "champion",
            "influence": "unknown",
            "last_contact_at": None,
            "status": "unknown",
        })
    return contacts


def _ticket_summaries(documents: list) -> list:
    """Pull excerpt-length text for ticket_escalation from documents whose
    type looks like a support ticket. Uses the raw_payload text already
    cached locally (never fetched live here)."""
    summaries = []
    for d in documents:
        doc_type = (d.get("type") or "").lower()
        if "ticket" in doc_type or "support" in doc_type:
            payload = d.get("raw_payload") or ""
            summaries.append(payload[:2000])
    return summaries


def _champion_note(claims: list) -> str | None:
    """Concatenate any claim whose field name suggests champion status or
    sentiment, used as the free text champion_departure scans."""
    notes = []
    for c in claims:
        field = (c.get("field") or "").lower()
        if field in CHAMPION_FIELD_NAMES or "sentiment" in field or "status" in field:
            notes.append(c.get("value") or "")
    return " ".join(notes) if notes else None


def _reference_date() -> str:
    override = os.environ.get("PIPELINE_REFERENCE_DATE")
    if override:
        return override
    return date.today().isoformat()


def _run_detectors(account_row: dict, claims: list, documents: list, usage_series: list) -> dict:
    """Run every pure Python detector for one account. Zero LLM calls here,
    per Master PRD rule 4."""
    ref = _reference_date()

    ut = detectors.usage_trend(usage_series)

    contacts = _extract_contacts(claims)
    last_contact_dates = [c["last_contact_at"] for c in contacts if c.get("last_contact_at")]
    # fall back to the most recent present document's date as a proxy for
    # "last inbound contact" when no explicit contact-status claim exists,
    # since that is the only date signal actually available in this dataset.
    if not last_contact_dates:
        doc_dates = [d.get("doc_date") for d in documents if d.get("doc_date")]
        last_contact_dates = doc_dates
    dslc = detectors.days_since_last_contact(ref, last_contact_dates) if last_contact_dates else None

    renewal_date = _extract_renewal_date(claims)
    rp = detectors.renewal_proximity(ref, renewal_date)

    te = detectors.ticket_escalation(_ticket_summaries(documents))

    contact_statuses = [{"role": "champion", "status": c.get("status")} for c in contacts]
    cd = detectors.champion_departure(_champion_note(claims), contact_statuses)

    # The CRM source data uses an em dash ("—") as its own placeholder
    # for "not set" on pre-sale accounts (health, tier, csOwner all do this).
    # Treated as unset here, same as a blank string, so it never leaks an em
    # dash into mismatch_reason or any other generated narrative text, per
    # Master PRD rule 6 (no em dashes in anything this system generates).
    raw_health = (account_row.get("health") or "").strip()
    crm_label = raw_health if raw_health and raw_health != "—" else "unknown"
    # derived_health is not known yet at detector time (that is synthesis's
    # job), so label_mismatch here is only used to build an evidence_hint
    # driver string for synthesis's prompt, not a final mismatch verdict.
    driver_bits = []
    if ut.get("trend") == "down" and ut.get("pct_change") is not None:
        driver_bits.append(f"flight hours down {abs(ut['pct_change'])} percent")
    if cd.get("departed"):
        driver_bits.append("champion departure signal")
    if te.get("escalated"):
        driver_bits.append("open escalation signal")
    evidence_hint = ", ".join(driver_bits) if driver_bits else None

    return {
        "usage_trend": ut,
        "days_since_last_contact": dslc,
        "renewal_proximity": rp,
        "ticket_escalation": te,
        "champion_departure": cd,
        "crm_label": crm_label,
        "renewal_date": renewal_date,
        "contacts": contacts,
        "evidence_hint": evidence_hint,
    }


def _derived_to_bucket(derived_health: str) -> str:
    if derived_health == "healthy":
        return "secure"
    if derived_health == "lost":
        return "lost"
    return "at_risk"


def _build_usage_payload(usage_series: list, usage_trend_result: dict):
    """Fixture shape: usage: {trend, pct_change, series:[{month,flight_hours,
    missions}]} or null when the account is not actively flying (empty
    series)."""
    if not usage_series:
        return None
    series = [
        {
            "month": item.get("month"),
            "flight_hours": item.get("flightHours"),
            "missions": item.get("missions"),
        }
        for item in usage_series
    ]
    trend = usage_trend_result.get("trend")
    # fixture example uses "declining"/"stable" style wording; map the
    # detector's up/down/flat/no_data vocabulary onto that without changing
    # the detector's own return contract.
    trend_label = {
        "down": "declining",
        "up": "growing",
        "flat": "stable",
        "no_data": "no_data",
    }.get(trend, trend)
    return {
        "trend": trend_label,
        "pct_change": usage_trend_result.get("pct_change"),
        "series": series,
    }


def _generate_actions(conn, account_id: str, account_row: dict, derived_health: str,
                       detector_results: dict, synth: dict, evidence_pool: set) -> list:
    """Deterministic action generation (plain Python, per Master PRD rule 4;
    the LLM already produced narrative risks/opportunities, this step only
    scores and ranks, it does not invent new claims). One action per account
    at most, focused on the single highest-urgency situation, consistent
    with the priority queue view being a ranked list, not a dump."""
    ref = _reference_date()
    rp = detector_results.get("renewal_proximity") or {}
    ut = detector_results.get("usage_trend") or {}
    cd = detector_results.get("champion_departure") or {}
    te = detector_results.get("ticket_escalation") or {}
    mismatch = synth.get("mismatch", False)

    reason_codes = []
    urgency = 10
    why_bits = []

    if rp.get("bucket") in ("overdue", "imminent"):
        reason_codes.append("renewal_proximity")
        urgency += 35
        why_bits.append(f"renewal {rp.get('bucket')} ({rp.get('days_until')} days)")
    elif rp.get("bucket") == "this_quarter":
        reason_codes.append("renewal_proximity")
        urgency += 15
        why_bits.append(f"renewal this quarter ({rp.get('days_until')} days)")

    if ut.get("trend") == "down":
        reason_codes.append("usage_decline")
        urgency += 20
        why_bits.append(f"usage down {abs(ut.get('pct_change') or 0)} percent")

    if cd.get("departed"):
        reason_codes.append("champion_departed")
        urgency += 25
        why_bits.append("champion departure signal detected")

    if te.get("escalated"):
        reason_codes.append("ticket_escalation")
        urgency += 15
        why_bits.append("open escalation signal in support history")

    if mismatch:
        reason_codes.append("crm_label_mismatch")
        urgency += 10
        why_bits.append("CRM label disagrees with derived health")

    if account_row.get("category") == "churned":
        winback = synth.get("winback") or {}
        if winback.get("worth_pursuing"):
            reason_codes.append("winnable_churn")
            urgency = max(urgency, 40)
            why_bits.append("churn assessed as winnable")

    if not reason_codes:
        # nothing urgent detected, no action generated for this account, per
        # Master PRD rule 3 (never fabricate an action with no evidence)
        return []

    urgency = min(urgency, 99)
    bucket = "now" if urgency >= 75 else "this_week" if urgency >= 45 else "watch"

    if derived_health == "lost" and "winnable_churn" in reason_codes:
        action_text = f"Open a winback conversation for {account_row.get('name')}."
    elif rp.get("bucket") in ("overdue", "imminent"):
        action_text = f"Prioritize a renewal touchpoint with {account_row.get('name')} before the window closes."
    elif cd.get("departed"):
        action_text = f"Re-establish a champion contact at {account_row.get('name')}, the prior champion signal has gone quiet."
    elif te.get("escalated"):
        action_text = f"Follow up on the open escalation signal at {account_row.get('name')} before it affects renewal."
    else:
        action_text = f"Review {account_row.get('name')}, usage and CRM signals disagree."

    why = ", ".join(why_bits) + "."

    evidence = sorted(evidence_pool)[:5] if evidence_pool else []

    action_id = f"act_{account_id}_{uuid.uuid4().hex[:8]}"
    db.insert_action(
        conn, action_id, account_id, action_text, why, reason_codes, urgency, bucket, evidence,
    )
    return [{
        "id": action_id,
        "account_id": account_id,
        "action": action_text,
        "why": why,
        "reason_codes": reason_codes,
        "urgency": urgency,
        "bucket": bucket,
        "evidence": evidence,
    }]


def derive_account(conn, account_id: str, account_row: dict) -> dict:
    """Run detectors + synthesis for one account and persist account_state.
    account_row is the raw list_accounts/get_account style dict (id, name,
    category, arr, health, sentiment, championTagged, etc), passed in by the
    caller (sync worker or a manual re-derive) since this module never calls
    MCP directly (Master PRD section 4: never live from MCP outside the sync
    worker).

    Returns the payload dict written (same shape as one entry of the fixture
    "accounts" array).
    """
    documents = db.get_present_documents(conn, account_id)
    claims = db.get_active_claims(conn, account_id)

    usage_doc = next((d for d in documents if d.get("type") == "usage"), None)
    usage_series = []
    if usage_doc and usage_doc.get("raw_payload"):
        try:
            usage_series = json.loads(usage_doc["raw_payload"])
        except (TypeError, json.JSONDecodeError):
            usage_series = []

    real_documents = [d for d in documents if d.get("type") != "usage"]

    detector_results = _run_detectors(account_row, claims, real_documents, usage_series)

    synth = synthesize_account(account_row, claims, detector_results, real_documents)

    derived_health = synth.get("derived_health") or "healthy"
    crm_label = detector_results["crm_label"]
    lm = detectors.label_mismatch(crm_label, derived_health, detector_results.get("evidence_hint"))

    stage = _account_stage(account_row.get("category"))
    arr = account_row.get("arr") or 0
    renewal_date = detector_results.get("renewal_date")

    usage_payload = _build_usage_payload(usage_series, detector_results["usage_trend"])

    claims_payload = [
        {
            "id": c.get("id"),
            "field": c.get("field"),
            "value": c.get("value"),
            "confidence": c.get("confidence"),
            "evidence": c.get("source_doc_ids") or [],
        }
        for c in claims
    ]

    account_payload = {
        "id": account_id,
        "name": account_row.get("name"),
        "stage": stage,
        "arr": arr,
        "renewal_date": renewal_date,
        "contacts": detector_results.get("contacts") or [],
        "usage": usage_payload,
        "risks": synth.get("risks") or [],
        "opportunities": synth.get("opportunities") or [],
        "claims": claims_payload,
        "winback": synth.get("winback"),
    }

    db.upsert_account_state(
        conn,
        account_id,
        derived_health=derived_health,
        crm_label=crm_label,
        mismatch=lm.get("mismatch", False),
        mismatch_reason=lm.get("reason"),
        stage=stage,
        arr=arr,
        renewal_date=renewal_date,
        payload=json.dumps(account_payload),
        is_dirty=False,
    )

    evidence_pool = set()
    for r in synth.get("risks") or []:
        evidence_pool.update(r.get("evidence") or [])
    for o in synth.get("opportunities") or []:
        evidence_pool.update(o.get("evidence") or [])
    for c in claims_payload:
        evidence_pool.update(c.get("evidence") or [])

    # replace this account's prior generated actions with a freshly derived
    # one (at most one, see _generate_actions), so actions never grow stale
    # or duplicate across sync cycles.
    conn.execute("DELETE FROM actions WHERE account_id = ?", (account_id,))
    conn.commit()
    _generate_actions(
        conn, account_id, account_row,
        derived_health, {**detector_results, "mismatch": lm.get("mismatch", False)},
        {**synth, "mismatch": lm.get("mismatch", False)}, evidence_pool,
    )

    return account_payload


def make_synthesis_fn(mcp_client_factory=None):
    """Build a synthesis_fn(account_id) -> None callable with the single
    argument signature backend.sync_worker.start_scheduler expects, closing
    over a fresh account_row lookup per call. account_row metadata is cheap
    (list_accounts is one call) and small (14 accounts), fine to look up per
    dirty account rather than plumbing it through the scheduler.

    mcp_client_factory, if given, is a zero arg callable returning an
    initialized McpClient; used by tests to avoid a real network call. When
    omitted, a real McpClient is opened and closed per call, mirroring how
    backend.sync_worker.run_sync_cycle already talks to MCP.
    """
    def _synthesis_fn(account_id: str):
        from mcp_client import McpClient
        conn = db.get_connection()
        try:
            client = mcp_client_factory() if mcp_client_factory else McpClient()
            owns_client = mcp_client_factory is None
            try:
                if owns_client:
                    client.initialize()
                accounts_result = client.call_tool("list_accounts")
                content = accounts_result.get("content") if isinstance(accounts_result, dict) else None
                accounts = json.loads(content[0]["text"]) if content else []
            finally:
                if owns_client:
                    client.close()
            account_row = next((a for a in accounts if a.get("id") == account_id), None)
            if account_row is None:
                logger.warning("synthesis_fn: account_id %s not found in list_accounts, skipping", account_id)
                return
            derive_account(conn, account_id, account_row)
        finally:
            conn.close()
    return _synthesis_fn


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if len(sys.argv) < 2:
        print("usage: python backend/pipeline.py <account_id>")
        raise SystemExit(1)

    account_id = sys.argv[1]

    from mcp_client import McpClient
    client = McpClient()
    client.initialize()
    accounts_result = client.call_tool("list_accounts")
    content = accounts_result.get("content")
    accounts = json.loads(content[0]["text"])
    client.close()

    account_row = next((a for a in accounts if a.get("id") == account_id), None)
    if account_row is None:
        raise SystemExit(f"account {account_id} not found")

    conn = db.get_connection()
    payload = derive_account(conn, account_id, account_row)
    conn.close()

    print(json.dumps(payload, indent=2))
