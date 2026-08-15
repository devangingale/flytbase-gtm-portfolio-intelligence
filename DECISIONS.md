# DECISIONS

Running log of choices made during the build, what was rejected, why, and cost
implications. Newest entries at the bottom.

## MCP client and discovery

- `mcp_client.py` was not actually present in the repo despite the PRD stating
  it was provided. Wrote it from scratch: JSON-RPC 2.0 over Streamable HTTP,
  handles both plain JSON and SSE-framed responses, session id propagation via
  `Mcp-Session-Id` header, `discover` / `call` / `snapshot` subcommands.
- Ran `python mcp_client.py discover` against the real endpoint. Real tool
  names differ from the PRD's placeholder assumption. Confirmed 9 tools:
  `list_accounts`, `get_account`, `list_account_documents`,
  `get_account_document`, `search_documents`, `get_account_usage`, plus three
  `se_*` tools for an unrelated SE-track dataset (not used here).
- Confirmed 14 real accounts via `list_accounts`, matching the PRD's account
  count, including the 2 churned accounts (Ravel Systems, Falcon Point
  Security).
- Tool responses come wrapped as MCP content blocks
  (`{"content": [{"type": "text", "text": "<json string>"}]}`), requiring an
  unwrap step before parsing.

## LLM provider

- No `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` was available in the environment.
  User chose NVIDIA NIM's free tier via the OpenAI-compatible SDK
  (`base_url=https://integrate.api.nvidia.com/v1`).
- User proposed 4 candidate model ids for testing:
  `nemotron-3.5-lightning-30b-a3b`, `nemotron-3-nano-30b-a3b`,
  `gemma-4-31b-it`, `nemotron-3-super-120b-a12b`.
- Test results (see scratchpad test scripts, not committed):
  - `gemma-4-31b-it` does not exist in the NIM catalog (only `gemma-3-*`
    variants are available); the closest real name timed out.
  - `nemotron-3-nano-30b-a3b` as literally named 404s; the catalog match
    (`nvidia/nemotron-3-nano-30b-a3b`) works but is a reasoning model that
    dumps raw chain-of-thought into `content` even with
    `response_format={"type": "json_object"}` set, never reaching clean JSON
    within 600 completion tokens. Same failure mode for
    `nemotron-3.5-lightning-30b-a3b`.
  - `nvidia/nemotron-3-super-120b-a12b` produced clean prose fast (~2.2s) but
    used an em dash in output despite an explicit instruction not to,
    violating PRD rule 6 (no em dashes anywhere).
  - `nvidia/llama-3.3-nemotron-super-49b-v1` produced clean, non-reasoning
    JSON on the extraction prompt and clean em-dash-free prose on the
    synthesis prompt at ~4s per call.
  - `nvidia/llama-3.3-nemotron-super-49b-v1.5` worked but was slower (~20s)
    and less reliably free of em dash-style punctuation.
- **Decision:** use `nvidia/llama-3.3-nemotron-super-49b-v1` for both
  extraction and synthesis. Single model simplifies the pipeline under time
  pressure; it was the only tested candidate that reliably avoided chain-of-
  thought leakage and em dashes without extra post-processing. Revisit only if
  latency or cost becomes a bottleneck at full portfolio scale.
- Cost: NIM free tier, no per-token billing to track for this submission.

## Stack

- Document store: SQLite (not Supabase/Postgres). Decision pending explicit
  time check against the "15 minutes" threshold in the PRD; SQLite chosen by
  default to avoid provisioning risk under a hard deadline, zero external
  dependency, and file-based so it is trivial to snapshot/inspect.

## Sync worker (backend/sync_worker.py)

- Usage is stored as a synthetic per-account pseudo-document
  (`f"{account_id}::usage"`, type="usage") in the same documents table, per
  the task spec, so it gets content-hash diffing for free. Deletion
  detection must exclude type="usage" rows from the "was present before but
  missing from list_account_documents now" check, since `list_account_documents`
  never returns it in the first place, it would otherwise look withdrawn on
  every single cycle after the first. Found this via a full second run
  against the live MCP server (docs_withdrawn came back 14, one per account,
  with zero real change on the source side) and fixed before wiring the
  scheduler.
- Usage updates mark the account dirty for synthesis but never trigger
  extraction: detectors that read usage are pure Python per PRD section 5
  step [4], there is no LLM extraction step for a usage series.
- `BackgroundScheduler` (APScheduler) runs jobs on its own worker thread, but
  a `sqlite3.Connection` can only be used on the thread that created it.
  Reusing the connection passed into `start_scheduler` from the caller's
  thread threw `sqlite3.ProgrammingError` on the first tick in testing.
  Fixed by having each scheduled tick open its own short-lived connection to
  the same database file (resolved via `PRAGMA database_list` on the
  passed-in connection) and close it when the cycle finishes; the caller's
  original connection is left untouched for its own thread (e.g. FastAPI
  request handlers) to keep using. `run_sync_cycle` itself takes whatever
  connection it is given and has no threading opinion, so it stays usable
  standalone (`python backend/sync_worker.py`) and from tests without this
  wrapper.
- Verified against the real MCP server: first cold sync found 14 accounts,
  87 documents, 14 usage series, all correctly marked dirty. Second
  immediate run was a full no-op (0 added/changed/withdrawn/usage) after the
  fix above, confirming content-hash diffing is working and idempotent.
  Content-change and deletion-detection paths (which the live server will
  not trigger on demand) were verified with a fake MCP client covering:
  new document, unchanged document (no-op), changed document (claim
  invalidation with reason "source document content changed"), withdrawn
  document (claim invalidation with reason "source document withdrawn",
  `is_present=0`, `withdrawn_at` set), and a final idempotent no-op cycle.

## Synthesis (backend/synthesis.py)

- `synthesize_account()` accepts `detector_results` pre-computed by the
  caller rather than importing and calling backend/detectors.py itself, so
  detector logic is never duplicated in this module and stays testable in
  isolation.
- Evidence is sanitized twice: the prompt only lists real document ids
  (from `documents` plus each claim's `source_doc_ids`), and every risk and
  opportunity returned by the model is dropped if none of its cited
  `evidence` ids are in that real set. No fabricated evidence reaches the
  fixture.
- A risk/opportunity is silently dropped (not replaced with a placeholder)
  when it has no supportable evidence, per rule 3 (never fake a result) and
  rule 5 (everything traces to a source document).
- If `is_trap` is true but the model left `counter_signal` empty, the trap
  claim is downgraded to a non trap rather than emitted unsupported, since
  PRD section 3.4 requires the counter signal to be named explicitly.
- `derived_health` is validated against the enum and, if the model returns
  something invalid or the LLM call/parse fails outright, falls back to a
  small deterministic function (`_fallback_health`) that reads
  `detector_results` directly (champion departure, open escalation, usage
  decline >= 25 percent, or label mismatch => at_risk). This keeps health
  never fully LLM-invented even in a degraded path, consistent with rule 4.
- `winback` is only populated when `account_row.category` (or `.stage`) is
  `"churned"`. On parse failure for a churned account, a conservative
  `worth_pursuing: false` placeholder is returned with the reason stated as
  "synthesis failure" rather than crashing or omitting the field, since the
  fixture contract requires winback to be an object or null, never missing.
- Defensive em dash stripping (`_strip_em_dashes`) runs on the parsed model
  output as a second layer under rule 6, in addition to the explicit
  no-em-dash instruction in both system and user prompts.
- Smoke tested standalone (`python backend/synthesis.py`) against
  `nvidia/llama-3.3-nemotron-super-49b-v1`: produced a correctly evidenced
  high severity risk, correctly flagged an expansion trap with an explicit
  counter signal, correctly derived `at_risk` health consistent with the
  fake detector signals, and correctly returned `winback: null` for a
  non-churned account.

## backend/db.py

- Implemented the five PRD section 6 tables exactly (documents, claims,
  account_state, actions, change_log) via CREATE TABLE IF NOT EXISTS, plain
  sqlite3, row_factory = sqlite3.Row. No ORM.
- `source_doc_ids` and `reason_codes` (spec'd as `text[]`, no native SQLite
  array type) are stored as JSON TEXT via two shared helpers, `encode_list`
  and `decode_list`. Every other module should use these two functions
  rather than calling json.dumps/loads directly, so empty/None/malformed
  values consistently round-trip to `[]` everywhere.
- `invalidate_claims_for_document` has no SQL array-containment operator to
  work with (JSON-as-TEXT), so it fetches all currently-active claims and
  filters in Python for doc_id membership in source_doc_ids, then bulk
  updates matched rows. Fine at this scale (14 accounts, small claim
  counts); would need a join table if this ever needed to scale.
- `mark_account_dirty` upserts: if no account_state row exists yet for the
  account_id, it inserts a minimal dirty row rather than silently no-oping,
  so a brand-new account is picked up by the next synthesis pass.
- Indexes added: documents(account_id), documents(content_hash) for the
  content-hash dedup check, claims(account_id), actions(account_id),
  change_log(account_id).
- DB path configurable via env DB_PATH, defaults to `gtm.db` at the repo
  root (resolved relative to backend/db.py's own location, not cwd, so it
  works regardless of where the process is launched from).
- Smoke tested standalone (`python backend/db.py`) and with a full
  round-trip functional test covering every exported helper (upsert doc,
  insert/invalidate claims, withdraw doc, dirty tracking on both existing
  and not-yet-existing account_state rows, actions, change_log). All
  passed.

## Extraction module (backend/extraction.py, PRD section 5 step [3])

- `extract_claims(document: dict) -> list[dict]` implemented as a pure
  "text in, claims out" function. Content-hash caching (never re-extract an
  unchanged document) is left to the sync worker/db layer, not this module:
  this module has no DB dependency and no knowledge of content_hash.
- Document text truncated to 6000 chars before sending to the model, to
  bound cost and latency on long transcripts. Logged via logger.info when
  truncation triggers. Not a correctness guarantee, a pragmatic cap under
  time pressure.
- Model called with response_format json_object, temperature 0.15,
  max_tokens 1200, 25s timeout, 1 retry on transient errors (timeout,
  connection error, 5xx) and no retry on 4xx.
- JSON parsing is defensive: direct json.loads, then outermost {...}
  substring search and retry, then give up and return [] with a logged
  warning rather than raising, so one bad document cannot kill the sync
  cycle (PRD rule 3: never fake data, but also never let one failure take
  down the whole run).
- Confidence values are validated against {high, medium, low} and coerced to
  "low" if the model returns something else, rather than dropping the claim.
- Smoke tested live against the real NIM endpoint
  (nvidia/llama-3.3-nemotron-super-49b-v1) with a fake QBR transcript
  mentioning a champion, a renewal date, a complaint, and an expansion
  signal: produced 6 clean claims (champion_identity, sentiment,
  risk_signals, renewal_timeline, opportunity_signals,
  explicit_health_status), correct confidence levels, no em dashes, ~3s
  round trip.

## Detectors (backend/detectors.py, pipeline step [4])

- All six required detectors implemented as pure functions over plain Python
  data (no DB rows, no LLM, no network), per Master PRD rule 4 and section 5:
  `usage_trend`, `days_since_last_contact`, `renewal_proximity`,
  `ticket_escalation`, `champion_departure`, `label_mismatch`.
- `usage_trend`: compares average of first half of the window against second
  half (not first-vs-last) when 4+ points are available, to avoid a couple of
  noisy months flipping the trend; falls back to last-vs-first for 2-3 points.
  Flat band set at +/-5% to avoid noise being reported as a trend. Single
  point or empty series returns `no_data` rather than crashing or guessing.
- `ticket_escalation` is intentionally crude keyword matching against a fixed
  term list (escalate, urgent, sev1, outage, unresolved, frustrated, angry,
  cancel, etc), not NLP. Documented in the function's docstring and inline.
  Real ticket text semantics are left to the LLM extraction step; this
  detector is a cheap deterministic backstop, not a replacement for it.
- `champion_departure` matches departure phrasing ("left the company", "no
  longer with", "unresponsive", "went quiet", etc) against both an optional
  free-text champion_note and any contact whose role contains "champion".
- `label_mismatch` normalizes both CRM label and derived health into
  healthy/at_risk/lost buckets before comparing (handles label variants like
  "green"/"yellow"/"red" and "churned"/"cancelled" as synonyms), and accepts
  an `evidence_hint` string so the synthesis/integration layer can interpolate
  the specific driver (usage trend, contact gap, etc) into the one-sentence
  mismatch reason without this module needing to know account internals.
- Smoke-tested standalone via `python backend/detectors.py` (16/16 pass, no
  pytest dependency needed for this module). Function signatures are frozen
  for the synthesis and integration stages to call directly:
  - `usage_trend(usage_series: list[dict]) -> dict`
  - `days_since_last_contact(reference_date: str, last_contact_dates: list[str]) -> int | None`
  - `renewal_proximity(reference_date: str, renewal_date: str | None) -> dict`
  - `ticket_escalation(ticket_summaries: list[str]) -> dict`
  - `champion_departure(champion_note: str | None, contact_statuses: list[dict]) -> dict`
  - `label_mismatch(crm_label: str, derived_health: str, evidence_hint: str | None = None) -> dict`

## Integration pass: reconciling the six parallel backend modules

Six agents wrote `backend/db.py`, `backend/detectors.py`, `backend/sync_worker.py`,
`backend/extraction.py`, `backend/synthesis.py`, and `backend/main.py` in parallel
without seeing each other's real code. This pass verified all six together, plus
`backend/pipeline.py` (the glue module `main.py` already depended on for
`make_synthesis_fn`, and which had already been written to bridge
`synthesize_account`'s 4-argument signature into the 1-argument
`synthesis_fn(account_id)` shape `sync_worker.start_scheduler` expects).

Found and fixed one real bug, ruled out two false alarms, and verified the full
pipeline end to end against the live MCP server and the live NIM endpoint.

### Bug fixed: `python backend/main.py` crashed with `ModuleNotFoundError: No module named 'backend'`

Root cause: `backend/main.py` had no `sys.path` guard (unlike `sync_worker.py`
and `pipeline.py`, which both insert the repo root at import time). When
launched as `python backend/main.py` directly, `sys.path[0]` is the `backend/`
directory itself, not the repo root, so `from backend import db` and friends
failed. The module's own defensive try/except around each sibling import
silently caught this and logged "not fully importable yet" for every single
sibling, and then `uvicorn.run("backend.main:app", ...)` (an import-string
target, re-resolved via `importlib` in-process) failed the same way,
crashing the process entirely on `reload=False`.

Fix: added the same `sys.path.insert(0, repo_root)` guard used by
`sync_worker.py`/`pipeline.py` to the top of `main.py`, and changed
`uvicorn.run("backend.main:app", ...)` to `uvicorn.run(app, ...)` (passing the
already-loaded FastAPI object directly instead of an import string), so no
re-import is needed at all when running as `__main__`. Both `python backend/main.py`
and `python -m backend.main` now work from the repo root; `-m` was never
broken (repo root is on `sys.path` automatically for `-m` invocation), but is
kept as the more robust of the two either way.

### Bug fixed: em dash leaking into `mismatch_reason` via raw CRM data

The `list_accounts`/`get_account` MCP data uses a literal em dash character
("—", U+2014) as the CRM's own placeholder for "not set" on pre-sale accounts
(seen on `health`, `tier`, `csOwner` for `ridgemont-polymers` and
`swiftline-logistics`, both `category: pre-sale`). `pipeline.py`'s
`crm_label = account_row.get("health") or "unknown"` treated this as a real,
truthy CRM label (an em dash is a non-empty string, so the `or "unknown"`
fallback never triggered), and `detectors.label_mismatch`'s f-string template
(`f"CRM says {crm_label}, ..."`) interpolated it verbatim into
`mismatch_reason`, producing an em dash in a field our own code generates.
This is a real violation of Master PRD rule 6 (no em dashes in anything the
system generates), even though the root cause is faithfully preserved,
correct source data (not fabricated, not a decoding bug).

Fixed in `pipeline.py._run_detectors`: `crm_label` now treats a blank string
or the literal "—" placeholder as unset, normalizing to "unknown" before it
ever reaches a template. Verified by re-running `python backend/pipeline.py
ridgemont-polymers` and `swiftline-logistics` and confirming `mismatch_reason`
no longer contains an em dash, then re-fetching `/api/portfolio` and
confirming zero em dash characters anywhere in the full JSON response.

### False alarm: mojibake-looking document titles were a terminal rendering artifact, not a bug

Some document titles/excerpts (e.g. `northline-grid`'s "Call Transcript —
Vendor Risk / Security Sign-Off Review") appeared as `�` when printed through
this session's Windows terminal. Traced all the way back to the raw HTTP
response bytes from the MCP server: the wire bytes are `\xe2\x80\x94`, the
correct UTF-8 encoding of an em dash, and the value stored in SQLite has the
correct Unicode codepoint (`0x2014`) when inspected via `ord()` rather than
`print()`. This is genuine, correctly-preserved source document content
(a real em dash used stylistically in a real document title), not a decoding
bug in `mcp_client.py` and not something the no-em-dash rule applies to
(that rule scopes to content this system generates: prompts, code, UI copy,
narrative text; not verbatim source document text, which must be preserved
faithfully per rule 3). No code change made for this. Only `label_mismatch`'s
generated reason string above was in scope and got fixed.

### Verification performed (all against the real MCP server and real NIM endpoint, no mocks)

- `python backend/db.py`: creates `gtm.db` with all 5 tables, clean exit.
- `python backend/detectors.py`: 16/16 self-tests pass.
- `python backend/sync_worker.py` standalone: reached the live MCP server,
  found all 14 accounts, 87 documents, 14 usage series on a cold sync;
  confirmed idempotent (a second immediate run is a full no-op).
- `python backend/extraction.py` and `python backend/synthesis.py` standalone:
  both hit the real NIM endpoint, produced valid, plausible, em-dash-free JSON.
- Full `python backend/main.py` startup: cold sync (87 docs added, 14 usage
  updates), sequential extraction across all 87 documents (591 claims total,
  one document timed out on both the initial call and its retry and was
  correctly skipped with a logged warning rather than crashing the cycle),
  then synthesis across all 14 accounts (all reached `derived_health` set,
  9 actions generated). Took roughly 25 minutes end to end on this run,
  almost entirely NIM API latency (20 to 25 second individual completions
  with frequent timeout-and-retry), not application code. This is the real,
  honest cost of one LLM call per document at portfolio scale on the current
  NIM endpoint; nothing was faked or short-circuited to make it finish faster.
- `GET /api/portfolio`: verified field-for-field against
  `fixtures/portfolio.json` at every nesting level (top level, account,
  health, contacts, usage, usage.series, risks, opportunities, claims,
  actions, documents, change_feed). All key sets match exactly.
- Both churned accounts (`ravel-systems`, `falcon-point-security`) have
  `stage: churned`, `health.derived: lost`, and a populated, distinct
  `winback` object; all 12 non-churned accounts have `winback: null`.
- Zero broken evidence references: every risk, opportunity, claim, and
  action's evidence array resolves to a real id in the `documents` array.
- Zero em dashes anywhere in the full `/api/portfolio` JSON response
  (after the `label_mismatch` fix above).
- CORS preflight (`OPTIONS /api/portfolio`) returns 200 with
  `access-control-allow-origin: *`.
- Server process killed cleanly after verification; not left running.

## Deployment (Render backend + Vercel frontend)

- Found a real bug while writing `render.yaml`: `backend/db.py` reads the
  database path from env var `DB_PATH`, but `backend/main.py` independently
  reads `GTM_DB_PATH` for the same purpose. Both default sensibly when unset
  (same relative path), which is why this was never caught: standalone runs
  of each module worked fine in isolation. Not fixed in code (out of scope
  to touch a working, verified module under deadline pressure); worked
  around in `render.yaml` by setting both env vars to the same value. Worth
  a follow-up to unify on one name if time remains after submission.
- Added `POST /api/sync` to `backend/main.py`, gated by a `SYNC_SECRET`
  shared-secret header (disabled with a 503 if the env var is unset, never
  silently open). Reuses the existing `_run_initial_sync_safely(conn)` path
  the startup scheduler already calls, so this is not a second
  implementation of the sync dispatch logic, just an extra caller. Added as
  a redundant safety net alongside the in-process APScheduler loop, per
  explicit user request given how much the PRD weights the self-updating
  requirement (section 2).
- `render.yaml`: one Render web service (FastAPI app, persistent 1GB disk
  at `/var/data` for `gtm.db` so it survives restarts/redeploys) plus one
  Render cron job (`*/5 * * * *`) that POSTs to `/api/sync` over Render's
  private internal network (`fromService: property: hostport`, plain
  `http://`, not a public HTTPS call) using a secret pulled from the web
  service's own generated `SYNC_SECRET` via
  `fromService: property: envVarKey`. `MCP_TOKEN` and `NIM_API_KEY` are
  `sync: false` (must be pasted into the Render dashboard manually, never
  committed).
- Chose Render over Vercel for the backend specifically because the app
  uses SQLite (a local file) and an in-process APScheduler background
  thread. Vercel serverless functions are stateless and spin down between
  invocations, so neither the database file nor the scheduler would persist
  there. Render's web service plan runs one long-lived container, which
  matches how this backend was actually built and verified.
- Frontend deploys to Vercel unchanged (React/Vite static build), pointed
  at the Render backend URL via the `VITE_API_BASE` build-time env var,
  per `FRONTEND_PRD.md`'s existing single-env-var-swap contract. No frontend
  code changes needed for deployment.

## SQLite to Postgres (Supabase) migration

- Render's free tier has no persistent disk and spins down idle instances,
  both fatal to a local SQLite file and the in-process 5-minute sync loop.
  User chose Supabase Postgres over paying for Render's Starter tier disk.
- New Supabase project `flytbase-gtm-portfolio` (ap-south-1, free tier,
  isolated from the user's unrelated pre-existing "RAG Pipeline Flytbase"
  project per explicit confirmation). Row Level Security intentionally left
  disabled on all 5 tables: the backend only ever connects via a direct
  Postgres connection string (psycopg2), never Supabase's REST API or
  client SDK, so the anon-key/RLS attack surface Supabase's advisory warns
  about does not apply here. Confirmed with the user before proceeding.
- Direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only on the free
  tier. Render (and this local dev machine) are IPv4-only, confirmed
  against Supabase's own docs which explicitly list Render as an
  IPv6-incompatible platform. Used the Supavisor shared pooler in session
  mode instead (`aws-0-ap-south-1.pooler.supabase.com:5432`, username
  `postgres.<project-ref>` not plain `postgres`), which is IPv4 on every
  tier. Session mode (not transaction mode) chosen because this is one
  long-lived FastAPI process making a persistent connection, not serverless
  or many short-lived clients.
- Rewrote `backend/db.py` to use `psycopg2` instead of `sqlite3`, but kept
  every exported function's exact name and signature unchanged, via a thin
  `_PgConnection` / `_PgCursor` adapter that mimics sqlite3's
  `conn.execute(sql, params).fetchone()/.fetchall()` chaining shape,
  rewrites `?` placeholders to `%s`, and returns dict-like rows
  (`RealDictCursor`). This let `backend/sync_worker.py`, `backend/pipeline.py`,
  and `backend/main.py` keep working with zero changes, including their
  direct `conn.execute(...)` calls outside the `db.py` helper functions
  (e.g. `pipeline.py`'s `DELETE FROM actions`).
- `sync_worker.py`'s `PRAGMA database_list` call (used only to resolve the
  on-disk file path of a `sqlite3.Connection` for the per-tick reconnect
  workaround) has no Postgres meaning. The adapter intercepts any `PRAGMA`
  statement and returns an empty result instead of erroring, so that
  caller's existing "row is None, fall back to a default" path runs
  unchanged rather than needing a code edit.
- Array-typed columns (`source_doc_ids`, `reason_codes`) kept as
  JSON-encoded TEXT (same as SQLite) rather than migrated to native
  Postgres `jsonb`/`text[]`, to avoid touching the `encode_list`/
  `decode_list` call sites in every other already-verified module.
- Found and fixed a real, pre-existing schema bug while porting: `claims.confidence`
  was typed `REAL` in the original SQLite schema, but every real caller
  (`extraction.py`, `synthesis.py`) always writes a string
  (`"high"|"medium"|"low"`), never a numeric score. SQLite silently
  tolerated this (no column type enforcement); Postgres correctly rejected
  the first real insert with `InvalidTextRepresentation`. Fixed the column
  to `TEXT` via migration, on both the live Supabase table and the
  `_SCHEMA` source string in `db.py` (for anyone re-running
  `get_connection()` against a fresh database).
- Verified with a full functional round-trip test covering every exported
  helper (upsert doc, insert/invalidate claims with `source_doc_ids`
  round-tripping as a Python list, withdraw doc, dirty tracking on both an
  existing and not-yet-existing `account_state` row, `upsert_account_state`,
  actions, `append_change_log`'s `RETURNING id` path, em dash stripping,
  and the `PRAGMA` no-op path) against the real Supabase Postgres instance,
  not a mock. All passed after the confidence column fix.
- `DB_PATH` / `GTM_DB_PATH` env vars (the earlier SQLite file-path
  mismatch noted above) are now vestigial: `get_connection()` only treats
  its `db_path` argument as meaningful if it looks like a connection
  string (contains `://` or starts with `postgres`), otherwise it falls
  back to `DATABASE_URL` / `SUPABASE_DB_URL` / `POSTGRES_URL`. Render's
  `render.yaml` blueprint (written before this migration, for the
  SQLite+disk plan) is superseded; the actual deploy uses a plain Render
  Web Service with `DATABASE_URL` set to the Supabase pooler string,
  no persistent disk needed.

## Frontend Live Integration & Fixture Decoupling

- Decoupled frontend from local mock fixture files (`fixtures/portfolio.json`). Removed Vite mock middleware.
- Configured Vite proxy to forward `/api` requests directly to the backend (`http://localhost:8000` or `VITE_API_BASE`).
- Polling hook (`usePortfolio`) now polls the live endpoint `GET /api/portfolio` every 20s and renders an awaiting-stream connection telemetry state when the backend is booting up or idle.
