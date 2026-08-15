"""Pure Python, zero LLM, zero network deterministic detectors (Master PRD rule 4, section 5 step [4]).

Every function takes plain Python data (not DB rows) so it is independently testable.
"""

from datetime import date, datetime


def usage_trend(usage_series: list[dict]) -> dict:
    """Classify usage direction from a get_account_usage series using half-window averages."""
    if not usage_series:
        return {"trend": "no_data", "pct_change": None, "series_normalized": []}

    series_normalized = [
        {
            "month": item.get("month"),
            "flight_hours": item.get("flightHours"),
            "missions": item.get("missions"),
        }
        for item in usage_series
    ]

    hours = [item.get("flightHours") or 0 for item in usage_series]

    if len(hours) == 1:
        return {"trend": "no_data", "pct_change": None, "series_normalized": series_normalized}

    if len(hours) < 4:
        first, last = hours[0], hours[-1]
    else:
        mid = len(hours) // 2
        first_half = hours[:mid]
        second_half = hours[mid:]
        first = sum(first_half) / len(first_half)
        last = sum(second_half) / len(second_half)

    if first == 0:
        if last == 0:
            pct_change = 0.0
        else:
            pct_change = 100.0
    else:
        pct_change = ((last - first) / first) * 100.0

    if abs(pct_change) < 5.0:
        trend = "flat"
    elif pct_change > 0:
        trend = "up"
    else:
        trend = "down"

    return {
        "trend": trend,
        "pct_change": round(pct_change, 1),
        "series_normalized": series_normalized,
    }


def days_since_last_contact(reference_date: str, last_contact_dates: list[str]) -> int | None:
    """Return days between reference_date and the most recent contact date, or None if no dates."""
    if not last_contact_dates:
        return None
    ref = datetime.strptime(reference_date, "%Y-%m-%d").date()
    parsed = [datetime.strptime(d, "%Y-%m-%d").date() for d in last_contact_dates]
    most_recent = max(parsed)
    return (ref - most_recent).days


def renewal_proximity(reference_date: str, renewal_date: str | None) -> dict:
    """Bucket a renewal date into overdue, imminent (<=30d), this_quarter (<=90d), later, or unknown."""
    if not renewal_date:
        return {"days_until": None, "bucket": "unknown"}

    ref = datetime.strptime(reference_date, "%Y-%m-%d").date()
    renewal = datetime.strptime(renewal_date, "%Y-%m-%d").date()
    days_until = (renewal - ref).days

    if days_until < 0:
        bucket = "overdue"
    elif days_until <= 30:
        bucket = "imminent"
    elif days_until <= 90:
        bucket = "this_quarter"
    else:
        bucket = "later"

    return {"days_until": days_until, "bucket": bucket}


ESCALATION_TERMS = [
    "escalate",
    "escalation",
    "urgent",
    "sev1",
    "outage",
    "unresolved",
    "frustrated",
    "angry",
    "cancel",
]


def ticket_escalation(ticket_summaries: list[str]) -> dict:
    """Crude case-insensitive keyword match against a fixed escalation term list, not NLP, by design."""
    matched_terms: list[str] = []
    signal_count = 0

    for text in ticket_summaries or []:
        lowered = (text or "").lower()
        for term in ESCALATION_TERMS:
            if term in lowered:
                signal_count += 1
                if term not in matched_terms:
                    matched_terms.append(term)

    return {
        "escalated": signal_count > 0,
        "signal_count": signal_count,
        "matched_terms": matched_terms,
    }


DEPARTURE_PHRASES = [
    "left the company",
    "no longer with",
    "unresponsive",
    "went quiet",
    "went silent",
    "no longer employed",
    "left flytbase",
    "departed",
]


def champion_departure(champion_note: str | None, contact_statuses: list[dict]) -> dict:
    """Flag champion departure via keyword match on champion_note and contact status/notes fields."""
    combined_texts: list[str] = []

    if champion_note:
        combined_texts.append(champion_note)

    for contact in contact_statuses or []:
        role = (contact.get("role") or "").lower()
        if "champion" not in role:
            continue
        for key in ("status", "notes", "note"):
            value = contact.get(key)
            if value:
                combined_texts.append(str(value))

    for text in combined_texts:
        lowered = text.lower()
        for phrase in DEPARTURE_PHRASES:
            if phrase in lowered:
                return {"departed": True, "signal": phrase}

    return {"departed": False, "signal": None}


HEALTHY_LABELS = {"healthy", "green", "good", "strong"}
AT_RISK_LABELS = {"at_risk", "at risk", "yellow", "warning", "watch"}
LOST_LABELS = {"lost", "churned", "red", "cancelled", "canceled"}


def _normalize_label(label: str) -> str:
    """Map a free-form CRM label or derived health string to healthy, at_risk, or lost."""
    lowered = (label or "").strip().lower()
    if lowered in HEALTHY_LABELS:
        return "healthy"
    if lowered in AT_RISK_LABELS:
        return "at_risk"
    if lowered in LOST_LABELS:
        return "lost"
    return lowered


def label_mismatch(crm_label: str, derived_health: str, evidence_hint: str | None = None) -> dict:
    """Compare normalized CRM label against derived health tier, produce a one-sentence reason if they disagree."""
    crm_norm = _normalize_label(crm_label)
    derived_norm = _normalize_label(derived_health)

    if crm_norm == derived_norm:
        return {"mismatch": False, "reason": None}

    driver = evidence_hint if evidence_hint else "recent account activity"
    reason = (
        f"CRM says {crm_label}, but derived health is {derived_health}, "
        f"driven by {driver}."
    )
    return {"mismatch": True, "reason": reason}


if __name__ == "__main__":
    passed = 0
    failed = 0

    def check(name: str, condition: bool):
        global passed, failed
        if condition:
            passed += 1
            print(f"PASS: {name}")
        else:
            failed += 1
            print(f"FAIL: {name}")

    # usage_trend
    ut_empty = usage_trend([])
    check("usage_trend empty -> no_data", ut_empty["trend"] == "no_data" and ut_empty["pct_change"] is None)

    ut_single = usage_trend([{"month": "2026-01", "flightHours": 10, "missions": 2}])
    check("usage_trend single point -> no_data, no crash", ut_single["trend"] == "no_data")

    ut_down = usage_trend([
        {"month": "2026-01", "flightHours": 100, "missions": 20},
        {"month": "2026-02", "flightHours": 90, "missions": 18},
        {"month": "2026-03", "flightHours": 40, "missions": 8},
        {"month": "2026-04", "flightHours": 30, "missions": 6},
    ])
    check("usage_trend down over 4 months", ut_down["trend"] == "down" and ut_down["pct_change"] < 0)

    ut_up_short = usage_trend([
        {"month": "2026-01", "flightHours": 10, "missions": 2},
        {"month": "2026-02", "flightHours": 25, "missions": 5},
    ])
    check("usage_trend up over 2 months (last vs first)", ut_up_short["trend"] == "up")

    # days_since_last_contact
    check(
        "days_since_last_contact basic",
        days_since_last_contact("2026-08-15", ["2026-08-01", "2026-07-20"]) == 14,
    )
    check("days_since_last_contact empty -> None", days_since_last_contact("2026-08-15", []) is None)

    # renewal_proximity
    rp_overdue = renewal_proximity("2026-08-15", "2026-08-01")
    check("renewal_proximity overdue", rp_overdue["bucket"] == "overdue" and rp_overdue["days_until"] == -14)

    rp_imminent = renewal_proximity("2026-08-15", "2026-09-05")
    check("renewal_proximity imminent", rp_imminent["bucket"] == "imminent")

    rp_unknown = renewal_proximity("2026-08-15", None)
    check("renewal_proximity unknown", rp_unknown["bucket"] == "unknown" and rp_unknown["days_until"] is None)

    # ticket_escalation
    te_hit = ticket_escalation(["Customer is frustrated and wants to cancel", "Sev1 outage reported"])
    check("ticket_escalation matches", te_hit["escalated"] is True and te_hit["signal_count"] >= 3)

    te_none = ticket_escalation(["Routine check-in call, all good"])
    check("ticket_escalation no match", te_none["escalated"] is False and te_none["signal_count"] == 0)

    # champion_departure
    cd_note = champion_departure("Champion left the company in July", [])
    check("champion_departure via note", cd_note["departed"] is True)

    cd_contact = champion_departure(None, [{"role": "Champion", "status": "unresponsive for 60 days"}])
    check("champion_departure via contact status", cd_contact["departed"] is True)

    cd_clean = champion_departure(None, [{"role": "Champion", "status": "engaged"}])
    check("champion_departure none", cd_clean["departed"] is False and cd_clean["signal"] is None)

    # label_mismatch
    lm_match = label_mismatch("healthy", "healthy")
    check("label_mismatch agree", lm_match["mismatch"] is False)

    lm_mismatch = label_mismatch("healthy", "at_risk", evidence_hint="flight hours down 43% over three months")
    check(
        "label_mismatch disagree with hint",
        lm_mismatch["mismatch"] is True and "flight hours down 43%" in lm_mismatch["reason"],
    )

    print(f"\n{passed} passed, {failed} failed")
