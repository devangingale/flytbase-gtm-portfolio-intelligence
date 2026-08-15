"""
Synthesis step (PRD section 5, step [5]).

Per-account synthesis using the stronger NIM model. Runs once per dirty
account, never per document. Turns deterministic detector signals plus
evidence (claims and documents) into the narrative fields required by the
frozen fixture contract: derived health, risks, opportunities (including
expansion traps), and winback assessment.

Deterministic logic (usage trend numbers, renewal date math, mismatch
booleans) is never computed here. That is backend/detectors.py's job. This
module only asks the LLM to read detector output plus evidence and produce
judgment calls: severity, is_trap, worth_pursuing, and readable narrative
text. See Master PRD rule 4.

Usage:
    python backend/synthesis.py     # runs a smoke test with fake fixtures
"""

import os
import sys
import json
import re
import logging

from openai import OpenAI

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s synthesis: %(message)s")
logger = logging.getLogger("synthesis")

NIM_BASE_URL = os.environ.get("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1")
NIM_API_KEY = os.environ.get("NIM_API_KEY")
NIM_SYNTHESIS_MODEL = os.environ.get("NIM_SYNTHESIS_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1")

CHURNED_CATEGORIES = {"churned"}

SYSTEM_PROMPT = """You are a GTM portfolio analyst for a drone autonomy company. You turn
deterministic account signals and source evidence into concise, decision-useful
account state.

Rules you must follow exactly:
1. Never invent facts. Every risk and every opportunity you output must be
   backed by at least one document id drawn only from the evidence document
   ids given to you in the input. If you cannot support a risk or opportunity
   with a real document id from the input, omit it entirely.
2. Do not compute or restate trend numbers, dates, or thresholds yourself.
   Treat the detector_results block as ground truth for those. Your job is
   narrative and judgment: severity, whether an opportunity is a trap, and
   whether a churned account is worth pursuing again.
3. An opportunity is a trap specifically when it is an expansion signal
   undercut by a counter signal: interest from someone with no budget
   authority, growth alongside an unresolved escalation, or a departed or
   disengaged champion. When is_trap is true, counter_signal must name the
   specific undercutting signal in plain language. When is_trap is false,
   counter_signal must be null.
4. Only produce a winback assessment when told the account is churned in the
   input. Otherwise winback must be null.
5. Never use an em dash (the character, not the word) anywhere in any text
   field you write. Use commas, colons, or parentheses instead.
6. Respond with JSON only. No markdown code fences, no commentary before or
   after the JSON object, no chain of thought.

Output must be a single JSON object with exactly these keys:
{
  "derived_health": "healthy" | "at_risk" | "lost",
  "risks": [
    {"title": string, "severity": "high" | "medium" | "low", "summary": string, "evidence": [doc_id, ...]}
  ],
  "opportunities": [
    {"title": string, "value_estimate": number, "is_trap": boolean, "counter_signal": string or null, "evidence": [doc_id, ...]}
  ],
  "winback": null or {
    "worth_pursuing": boolean,
    "rationale": string,
    "required_effort": string
  }
}

evidence arrays must contain only document ids that were present in the input.
If there is no supportable risk, return an empty risks list. If there is no
supportable opportunity, return an empty opportunities list. Do not pad either
list to make the account look more interesting than the evidence supports."""


def _build_user_prompt(account_row, claims, detector_results, documents, is_churned):
    doc_ids = [d.get("id") or d.get("file") for d in documents]
    payload = {
        "account": {
            "id": account_row.get("id"),
            "name": account_row.get("name"),
            "category": account_row.get("category"),
            "vertical": account_row.get("vertical"),
            "tier": account_row.get("tier"),
            "arr": account_row.get("arr"),
            "crm_health_label": account_row.get("health"),
            "sentiment": account_row.get("sentiment"),
            "champion_tagged": account_row.get("championTagged"),
        },
        "is_churned": is_churned,
        "detector_results": detector_results,
        "claims": [
            {
                "field": c.get("field"),
                "value": c.get("value"),
                "confidence": c.get("confidence"),
                "evidence": c.get("source_doc_ids") or c.get("evidence") or [],
            }
            for c in claims
        ],
        "available_document_ids": doc_ids,
        "documents": [
            {
                "id": d.get("id") or d.get("file"),
                "type": d.get("type"),
                "title": d.get("title"),
                "date": d.get("date"),
            }
            for d in documents
        ],
    }
    instructions = (
        "Using only the evidence below, produce the JSON object described in the "
        "system prompt. derived_health must be consistent with detector_results "
        "(do not contradict a clear usage decline, unresolved escalation, or "
        "champion departure signal already present there). "
    )
    if is_churned:
        instructions += (
            "This account is churned: you must include a winback assessment "
            "(non null), grounded in the claims and documents given, especially "
            "any churn reason claim. "
        )
    else:
        instructions += "This account is not churned: winback must be null. "
    instructions += "Respond with JSON only, no markdown fences, no commentary."

    return instructions + "\n\nINPUT:\n" + json.dumps(payload, default=str)


def _extract_json_block(text):
    """Fallback: find the outermost {...} block by brace matching."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    return None
    return None


def _strip_em_dashes(value):
    """Defensive cleanup: replace any em dash the model slipped in with a comma."""
    if isinstance(value, str):
        return value.replace("—", ",")
    if isinstance(value, list):
        return [_strip_em_dashes(v) for v in value]
    if isinstance(value, dict):
        return {k: _strip_em_dashes(v) for k, v in value.items()}
    return value


def _valid_doc_ids(documents):
    ids = set()
    for d in documents:
        did = d.get("id") or d.get("file")
        if did:
            ids.add(did)
    return ids


def _sanitize_evidence(evidence_list, valid_ids):
    if not isinstance(evidence_list, list):
        return []
    return [e for e in evidence_list if e in valid_ids]


def _call_nim(system_prompt, user_prompt):
    if not NIM_API_KEY:
        raise RuntimeError("NIM_API_KEY is not set (env var or .env)")
    client = OpenAI(base_url=NIM_BASE_URL, api_key=NIM_API_KEY)
    response = client.chat.completions.create(
        model=NIM_SYNTHESIS_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.25,
        max_tokens=1500,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content


def synthesize_account(account_row: dict, claims: list, detector_results: dict, documents: list) -> dict:
    """
    Synthesize derived health, risks, opportunities, and winback for one
    account using the stronger NIM model. Called once per dirty account.

    account_row: raw CRM metadata for the account (list_accounts/get_account shape).
    claims: active (non invalidated) claims for this account, each with
        field/value/confidence/source_doc_ids.
    detector_results: pre-computed pure Python detector outputs for this
        account (usage_trend, renewal_proximity, ticket_escalation,
        champion_departure, label_mismatch, etc). This module runs no
        detector logic itself.
    documents: present documents for this account, each with id/type/title/date.

    Returns a dict:
    {
        "derived_health": "healthy" | "at_risk" | "lost",
        "risks": [{"id", "title", "severity", "summary", "evidence": [doc_id,...]}],
        "opportunities": [{"id", "title", "value_estimate", "is_trap", "counter_signal", "evidence": [doc_id,...]}],
        "winback": None or {"applicable": True, "worth_pursuing": bool, "rationale": str, "required_effort": str}
    }
    """
    account_id = account_row.get("id", "unknown")
    category = (account_row.get("category") or account_row.get("stage") or "").lower()
    is_churned = category in CHURNED_CATEGORIES

    valid_ids = _valid_doc_ids(documents)
    # claims also carry evidence document ids, include those as valid too,
    # since a claim's source doc is by definition a real fetched document.
    for c in claims:
        for did in (c.get("source_doc_ids") or c.get("evidence") or []):
            valid_ids.add(did)

    fallback = {
        "derived_health": _fallback_health(detector_results),
        "risks": [],
        "opportunities": [],
        "winback": None,
    }

    if not valid_ids:
        logger.warning(
            "account %s has no evidence documents available, skipping LLM call, "
            "returning health only with empty risks/opportunities",
            account_id,
        )
        if is_churned:
            fallback["winback"] = {
                "applicable": True,
                "worth_pursuing": False,
                "rationale": "No source documents are available to support a winback assessment.",
                "required_effort": "unknown, insufficient evidence",
            }
        return fallback

    user_prompt = _build_user_prompt(account_row, claims, detector_results, documents, is_churned)

    try:
        raw = _call_nim(SYSTEM_PROMPT, user_prompt)
    except Exception as e:
        logger.error("NIM call failed for account %s: %s", account_id, e)
        return fallback

    parsed = None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning("account %s: direct json.loads failed, trying brace extraction", account_id)
        parsed = _extract_json_block(raw or "")

    if parsed is None:
        logger.error(
            "account %s: could not parse synthesis output as JSON, degrading to "
            "detector-only health with empty risks/opportunities, no fabricated fallback",
            account_id,
        )
        if is_churned:
            fallback["winback"] = {
                "applicable": True,
                "worth_pursuing": False,
                "rationale": "Synthesis output could not be parsed, no winback assessment available.",
                "required_effort": "unknown, synthesis failure",
            }
        return fallback

    parsed = _strip_em_dashes(parsed)

    derived_health = parsed.get("derived_health")
    if derived_health not in ("healthy", "at_risk", "lost"):
        logger.warning(
            "account %s: model returned invalid derived_health %r, falling back to detector-derived value",
            account_id, derived_health,
        )
        derived_health = _fallback_health(detector_results)

    risks = []
    for i, r in enumerate(parsed.get("risks") or []):
        evidence = _sanitize_evidence(r.get("evidence"), valid_ids)
        if not evidence:
            logger.warning(
                "account %s: dropping risk %r, no valid evidence document ids",
                account_id, r.get("title"),
            )
            continue
        severity = r.get("severity")
        if severity not in ("high", "medium", "low"):
            severity = "medium"
        risks.append({
            "id": f"risk_{account_id}_{i + 1}",
            "title": r.get("title") or "Untitled risk",
            "severity": severity,
            "summary": r.get("summary") or "",
            "evidence": evidence,
        })

    opportunities = []
    for i, o in enumerate(parsed.get("opportunities") or []):
        evidence = _sanitize_evidence(o.get("evidence"), valid_ids)
        if not evidence:
            logger.warning(
                "account %s: dropping opportunity %r, no valid evidence document ids",
                account_id, o.get("title"),
            )
            continue
        is_trap = bool(o.get("is_trap"))
        counter_signal = o.get("counter_signal") if is_trap else None
        if is_trap and not counter_signal:
            logger.warning(
                "account %s: opportunity %r marked is_trap with no counter_signal, "
                "downgrading to non trap since the trap claim is unsupported",
                account_id, o.get("title"),
            )
            is_trap = False
            counter_signal = None
        try:
            value_estimate = float(o.get("value_estimate") or 0)
        except (TypeError, ValueError):
            value_estimate = 0
        opportunities.append({
            "id": f"opp_{account_id}_{i + 1}",
            "title": o.get("title") or "Untitled opportunity",
            "value_estimate": value_estimate,
            "is_trap": is_trap,
            "counter_signal": counter_signal,
            "evidence": evidence,
        })

    winback = None
    if is_churned:
        wb = parsed.get("winback")
        if isinstance(wb, dict):
            winback = {
                "applicable": True,
                "worth_pursuing": bool(wb.get("worth_pursuing")),
                "rationale": wb.get("rationale") or "",
                "required_effort": wb.get("required_effort") or "unknown",
            }
        else:
            logger.warning(
                "account %s is churned but model returned no winback object, "
                "degrading to a conservative not worth pursuing assessment",
                account_id,
            )
            winback = {
                "applicable": True,
                "worth_pursuing": False,
                "rationale": "Synthesis did not produce a winback assessment for this churned account.",
                "required_effort": "unknown",
            }

    return {
        "derived_health": derived_health,
        "risks": risks,
        "opportunities": opportunities,
        "winback": winback,
    }


def _fallback_health(detector_results):
    """
    Deterministic, LLM-free fallback for derived_health when synthesis fails
    or cannot run. Uses detector_results only, per Master PRD rule 4 (and
    rule 3: never fabricate, degrade honestly instead).
    """
    if not detector_results:
        return "healthy"
    if detector_results.get("champion_departure") or detector_results.get("ticket_escalation"):
        return "at_risk"
    trend = (detector_results.get("usage_trend") or {})
    if isinstance(trend, dict) and trend.get("direction") == "declining":
        pct = trend.get("pct_change")
        if isinstance(pct, (int, float)) and pct <= -25:
            return "at_risk"
    if detector_results.get("label_mismatch"):
        return "at_risk"
    return "healthy"


if __name__ == "__main__":
    fake_account_row = {
        "id": "acct_099",
        "name": "Harrow Coastal Survey",
        "category": "established",
        "vertical": "maritime survey",
        "tier": "mid_market",
        "arr": 180000,
        "health": "healthy",
        "sentiment": "neutral",
        "championTagged": "Marcus Yeboah, Survey Operations Lead",
    }

    fake_claims = [
        {
            "field": "champion",
            "value": "Marcus Yeboah, Survey Operations Lead",
            "confidence": "high",
            "source_doc_ids": ["doc_101"],
        },
        {
            "field": "escalation_status",
            "value": "Open critical ticket since June regarding firmware crash on survey missions, unresolved after 47 days.",
            "confidence": "high",
            "source_doc_ids": ["doc_104"],
        },
        {
            "field": "expansion_interest",
            "value": "A field technician asked about adding two more drones during a support call, no budget authority mentioned and never followed up by the economic buyer.",
            "confidence": "medium",
            "source_doc_ids": ["doc_105"],
        },
    ]

    fake_detector_results = {
        "usage_trend": {"direction": "declining", "pct_change": -31.4, "window_months": 3},
        "renewal_proximity": {"days_to_renewal": 54, "is_near": True},
        "ticket_escalation": {"has_open_critical": True, "days_open": 47},
        "champion_departure": False,
        "label_mismatch": {
            "mismatch": True,
            "reason": "CRM says healthy, flight hours down 31 percent over three months with an unresolved critical ticket.",
        },
    }

    fake_documents = [
        {"id": "doc_101", "type": "call_transcript", "title": "QBR call, June", "date": "2026-06-10"},
        {"id": "doc_104", "type": "support_ticket", "title": "Firmware crash on survey mission", "date": "2026-06-24"},
        {"id": "doc_105", "type": "call_transcript", "title": "Support call, expansion mention", "date": "2026-07-02"},
    ]

    print(f"Using model: {NIM_SYNTHESIS_MODEL}")
    result = synthesize_account(fake_account_row, fake_claims, fake_detector_results, fake_documents)
    print(json.dumps(result, indent=2))
