"""
Per-document claim extraction (Master PRD section 5, step [3]).

Given ONE document's raw text, call the cheap/fast NIM model and produce a
list of claim dicts ready for the db module's insert_claims helper. Caching
by content_hash (so an unchanged document is never re-extracted) is the
caller's (sync worker's) responsibility, not this module's: this module is a
pure "text in, claims out" function.

Env required:
    NIM_API_KEY     NVIDIA NIM API key (required)
    NIM_BASE_URL    defaults to https://integrate.api.nvidia.com/v1
    NIM_EXTRACTION_MODEL   defaults to nvidia/llama-3.3-nemotron-super-49b-v1
"""

import os
import sys
import json
import uuid
import logging
from datetime import datetime, timezone

from openai import OpenAI, APIStatusError, APITimeoutError, APIConnectionError

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger("extraction")

NIM_BASE_URL = os.environ.get("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1")
NIM_EXTRACTION_MODEL = os.environ.get("NIM_EXTRACTION_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1")

# Truncate document text to control cost/latency on long transcripts. Claims
# in the first ~6000 chars capture the vast majority of GTM signal in these
# documents (profiles, transcripts, tickets); this is a pragmatic cap, not a
# correctness guarantee, and is logged when it triggers.
MAX_DOC_CHARS = 6000

REQUEST_TIMEOUT_SECONDS = 25.0
MAX_RETRIES = 1  # one retry on transient errors only, never on 4xx

VALID_CONFIDENCE = {"high", "medium", "low"}

SYSTEM_PROMPT = """You are a claim extraction engine for a GTM (go-to-market) account intelligence \
system. You read one source document about a customer account (a call transcript, email, support \
ticket, internal note, CRM profile, or renewal table) and extract discrete, factual claims relevant \
to the account's state.

Extract claims about, where present in the text:
- champion identity and role (who is the internal advocate, their title or function)
- sentiment (positive, neutral, negative, and what signals it)
- usage or flight-hour mentions (specific numbers, trends, or qualitative statements about usage)
- renewal timeline mentions (dates, quarters, contract terms)
- risk signals (escalations, complaints, unresponsiveness, churn language)
- opportunity signals (expansion interest, new use cases, additional dock or seat requests)
- explicit health or status statements (anything the document itself says about account health)

Rules:
1. Only extract claims that are actually supported by the document text. Do not invent claims.
2. Each claim needs: a short snake_case field name, a plain text value (a concise statement, not a \
long quote), and a confidence level of "high", "medium", or "low" based on how directly the document \
states it (high: stated explicitly and unambiguously, medium: stated but with some ambiguity or \
partial phrasing, low: inferred or implied rather than directly stated).
3. If the document has no relevant claims for a category, omit that category entirely. Do not pad \
output with empty or speculative claims.
4. Do not use em dashes anywhere in your output. Use commas, colons, or parentheses instead.
5. Respond with JSON only, no markdown fences, no commentary, no chain of thought, no preamble.

Respond with a JSON object of exactly this shape:
{"claims": [{"field": "champion_identity", "value": "Jane Doe, VP of Operations", "confidence": "high"}]}

If there are no extractable claims, respond with {"claims": []}."""


def _build_user_prompt(document: dict, text: str) -> str:
    return (
        f"Account id: {document.get('account_id', 'unknown')}\n"
        f"Document type: {document.get('type', 'unknown')}\n"
        f"Document title: {document.get('title', 'untitled')}\n\n"
        f"Document text:\n{text}\n\n"
        "Extract the claims per the rules above. Respond with JSON only, no markdown fences, "
        "no commentary. Do not use em dashes anywhere in your output: use commas, colons, or "
        "parentheses instead."
    )


def _get_client() -> OpenAI:
    api_key = os.environ.get("NIM_API_KEY")
    if not api_key:
        raise RuntimeError("NIM_API_KEY is not set in the environment")
    return OpenAI(api_key=api_key, base_url=NIM_BASE_URL, timeout=REQUEST_TIMEOUT_SECONDS)


def _call_model(client: OpenAI, system_prompt: str, user_prompt: str) -> str:
    """Call the NIM chat completion endpoint with one retry on transient errors.

    Retries on timeouts, connection errors, and 5xx responses. Does not retry
    on 4xx (bad request, auth failure, etc), since retrying those just burns
    time for the same failure.
    """
    attempt = 0
    last_error = None
    while attempt <= MAX_RETRIES:
        try:
            response = client.chat.completions.create(
                model=NIM_EXTRACTION_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.15,
                max_tokens=1200,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content or ""
        except APIStatusError as exc:
            # 4xx: do not retry, this will fail identically next time.
            if exc.status_code is not None and 400 <= exc.status_code < 500:
                raise
            last_error = exc
        except (APITimeoutError, APIConnectionError) as exc:
            last_error = exc
        attempt += 1
    # Exhausted retries on a transient error class.
    raise last_error


def _parse_claims_json(raw_text: str) -> list:
    """Defensively parse the model's JSON output.

    1. Try a direct json.loads.
    2. If that fails, find the outermost {...} block by string search and
       retry.
    3. If that still fails, return None so the caller can log and skip.
    """
    if not raw_text:
        return None

    try:
        parsed = json.loads(raw_text)
        return parsed.get("claims", [])
    except (json.JSONDecodeError, AttributeError):
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = raw_text[start:end + 1]
        try:
            parsed = json.loads(candidate)
            return parsed.get("claims", [])
        except (json.JSONDecodeError, AttributeError):
            pass

    return None


def extract_claims(document: dict) -> list:
    """Extract GTM claims from one document's text.

    Args:
        document: dict with at least {id, account_id, type, title, raw_payload}
                  where raw_payload is the document's markdown/plain text.

    Returns:
        A list of claim dicts, each shaped:
        {
            "id": <uuid4 hex string>,
            "account_id": <document["account_id"]>,
            "field": <short snake_case field name>,
            "value": <plain text value>,
            "confidence": "high" | "medium" | "low",
            "source_doc_ids": [<document["id"]>],
            "extracted_at": <ISO 8601 UTC timestamp string>,
        }
        Returns an empty list if the document has no extractable claims, or
        if extraction fails for any reason (never raises out of this
        function on a model/parsing failure, so one bad document cannot
        kill the whole sync cycle).
    """
    doc_id = document.get("id")
    account_id = document.get("account_id")
    raw_text = document.get("raw_payload") or ""

    if not raw_text.strip():
        logger.warning("extract_claims: document %s has empty raw_payload, skipping", doc_id)
        return []

    truncated = len(raw_text) > MAX_DOC_CHARS
    text = raw_text[:MAX_DOC_CHARS]
    if truncated:
        logger.info(
            "extract_claims: document %s truncated from %d to %d chars",
            doc_id, len(raw_text), MAX_DOC_CHARS,
        )

    user_prompt = _build_user_prompt(document, text)

    try:
        client = _get_client()
        raw_response = _call_model(client, SYSTEM_PROMPT, user_prompt)
    except Exception as exc:
        logger.warning("extract_claims: model call failed for document %s: %s", doc_id, exc)
        return []

    claims_raw = _parse_claims_json(raw_response)
    if claims_raw is None:
        logger.warning(
            "extract_claims: could not parse JSON from model response for document %s, "
            "returning no claims. Raw response head: %r",
            doc_id, raw_response[:200] if raw_response else raw_response,
        )
        return []

    if not isinstance(claims_raw, list):
        logger.warning("extract_claims: 'claims' was not a list for document %s, skipping", doc_id)
        return []

    now = datetime.now(timezone.utc).isoformat()
    claims = []
    for item in claims_raw:
        if not isinstance(item, dict):
            continue
        field = item.get("field")
        value = item.get("value")
        confidence = item.get("confidence", "low")
        if not field or not value:
            continue
        if confidence not in VALID_CONFIDENCE:
            confidence = "low"
        claims.append({
            "id": uuid.uuid4().hex,
            "account_id": account_id,
            "field": str(field),
            "value": str(value),
            "confidence": confidence,
            "source_doc_ids": [doc_id],
            "extracted_at": now,
        })

    return claims


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    fake_document = {
        "id": "doc_smoketest_001",
        "account_id": "northline-grid",
        "type": "call_transcript",
        "title": "QBR call, July 2026",
        "raw_payload": """
# Northline Grid, QBR call notes, July 2026

Attendees: Sarah Chen (VP of Field Operations, our main champion on this account), \
our CSM, our SE.

Sarah opened by saying the pilot program has gone well but flight ops has been \
frustrated with dispatch latency over the last month. She said: "if this isn't \
resolved before renewal, I don't know how I sell this internally again."

Renewal date is confirmed for October 15, 2026. Sarah mentioned budget is already \
approved for a flat renewal but any expansion would need a new business case.

On the positive side, the regional ops lead asked about adding two more docks at \
a second site, pending resolution of the latency issue above.

No mention of flight hour counts on this call, usage data comes from a separate \
system of record.
""",
    }

    result = extract_claims(fake_document)
    print(json.dumps(result, indent=2))
