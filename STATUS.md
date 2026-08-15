# STATUS

## Done
- MCP discovery complete. Real tool names confirmed, `schema.json` written.
- `.env` configured with MCP token and NIM API key (gitignored, not committed).
- `.gitignore` created before any git operations.
- LLM models selected and tested: `nvidia/llama-3.3-nemotron-super-49b-v1` for
  both extraction and synthesis.
- Frontend scaffold already exists (React/Vite/TS, all 7 views built) from a
  prior agent run. Reads `fixtures/portfolio.json` locally, swaps to
  `VITE_API_BASE` for live API.
- **Backend is fully built, integrated, and verified end to end against real
  data.** All six modules (`db.py`, `detectors.py`, `sync_worker.py`,
  `extraction.py`, `synthesis.py`, `main.py`) plus the glue module
  `pipeline.py` (detector + synthesis orchestration per account, writes
  `account_state` and `actions`) import cleanly and interoperate correctly.
  `backend/requirements.txt` written and confirmed accurate against actual
  imports.
- Fixed: `python backend/main.py` crashed with `ModuleNotFoundError` on a
  fresh process (missing `sys.path` repo-root guard, plus an import-string
  `uvicorn.run` target that tried to re-resolve `backend.main` from the
  wrong working directory). Fixed in `main.py`; both `python backend/main.py`
  and `python -m backend.main` now work. See DECISIONS.md for detail.
- Fixed: `label_mismatch`'s generated `mismatch_reason` text leaked a literal
  em dash for two pre-sale accounts whose CRM `health` field is itself an
  em dash placeholder ("not set"). Fixed in `pipeline.py`, verified zero em
  dashes anywhere in a full `/api/portfolio` response afterward.
- Verified live: `sync_worker.py` reaches the real MCP server and pulls all
  14 accounts, 87 real documents, 14 usage series, correctly idempotent on a
  second run (0 changes). `extraction.py` and `synthesis.py` both verified
  live against the real NIM endpoint, producing valid, plausible,
  em-dash-free JSON.
- Verified live: a full cold `python backend/main.py` startup (real MCP sync,
  real per-document extraction across all 87 documents, real per-account
  synthesis across all 14 accounts) completes successfully end to end
  (roughly 25 minutes, almost entirely NIM API latency, not app overhead;
  one document extraction timed out on both its call and its retry and was
  correctly skipped rather than crashing the cycle). `GET /api/portfolio`
  and `GET /api/health` both verified against a live server: field sets
  match `fixtures/portfolio.json` exactly at every nesting level (account,
  health, contacts, usage, risks, opportunities, claims, actions, documents,
  change_feed). Both churned accounts (`ravel-systems`,
  `falcon-point-security`) have populated, distinct winback assessments; all
  12 non-churned accounts correctly have `winback: null`. Every risk,
  opportunity, claim, and action evidence id resolves to a real document id
  (zero broken references). CORS preflight verified. Server process was
  killed after verification, not left running.

- Fixed: independent verification found 46 `change_log` entries with a
  literal em dash leaking through from source document titles interpolated
  into system-generated descriptions (e.g. "New document added: Call
  Transcript [em dash] Vendor Risk Review (transcript)"), violating rule 6.
  Root-caused to `db.append_change_log()`, which had no sanitization, unlike
  `synthesis.py`'s LLM output path. Fixed centrally in `backend/db.py` with
  a `_strip_em_dash()` helper applied to every `description`/`consequence`
  write, so every call site is covered regardless of what gets interpolated.
  Backfilled all 46 existing rows in `gtm.db` (verified 0 remaining via
  direct query and via `db.get_change_log()`, the same call path
  `/api/portfolio` uses). Also swept `claims`, `actions`, and
  `account_state.payload` for the same issue: none found, this was isolated
  to change_log.

## In progress
- None on the backend. Backend is functionally complete against PRD section 3.

## Not started
- Deployment (backend, frontend).
- Verification gate 1 (induced source change propagates end to end): the
  content-hash change/withdrawal-detection code paths are implemented and
  were unit-verified with a fake MCP client during initial `sync_worker.py`
  development (see DECISIONS.md), but have not yet been re-verified against
  a real, human-induced change to a live source document in this session.

## Known gaps / risks
- `mcp_client.py` was described as "provided" in the PRD but was not present;
  written from scratch this session.
- Backend stack (SQLite vs Supabase) not yet finalized, see DECISIONS.md.
- Cold-start latency: a full 14-account, 87-document sync from empty takes
  roughly 20 to 25 minutes on this run, dominated by sequential NIM API
  calls (20 to 25s each, with retries on frequent timeouts). This is honest,
  real-data behavior (one LLM call per document, per Master PRD cost
  discipline), not a shortcut, but worth knowing before a live demo: do not
  start from an empty `gtm.db` moments before presenting.
- Frontend has not been re-verified against the now-fixed backend in this
  session (out of scope per this task's instructions: `src/` was not
  touched).
