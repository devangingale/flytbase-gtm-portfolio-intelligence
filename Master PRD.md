# MASTER PRD: FlytBase GTM Portfolio Intelligence System

**Human owner:** Dev
**Built by:** Claude Code
**Hard deadline:** submission closes 5:00 PM today. Code freeze 4:15 PM.

You own the full build. The human owns verification gates, the demo, and the
submission. Read this entire document before writing code.

---

## 0. Operating rules for the agent

These override your defaults. Violating them fails the project even if the code
is good.

1. **Ship a running skeleton before building anything smart.** A deployed
   dashboard reading a fixture, and a sync loop that logs diffs, both within the
   first 90 minutes. Deployment is never left to the end.
2. **Do not add scope.** If a capability is not in section 3, do not build it,
   even if it seems obviously useful. Flag it and move on.
3. **Never fake a result.** No placeholder data presented as real, no hardcoded
   example output, no `TODO: replace with real logic` shipped in a working path.
   If something does not work, say so in `STATUS.md`.
4. **Deterministic logic stays deterministic.** Numeric trends, date math,
   scoring, and thresholds are Python, not LLM calls. LLMs extract and
   summarize. They do not compute.
5. **Everything the system asserts must trace to a source document.** No claim,
   risk, action, or health label without `evidence: [doc_id]`.
6. **No em dashes anywhere.** Not in code comments, not in UI copy, not in LLM
   prompts or generated text. Use commas, colons, or parentheses. Add this
   instruction to every LLM system prompt you write.
7. **Log decisions as you go** in `DECISIONS.md`: what you chose, what you
   rejected, why, and cost implications. This is a graded artifact.
8. **Stop and ask** if the MCP tool schema does not match section 4
   expectations. Do not invent an adapter around a guess.

---

## 1. The problem

A GTM team (customer success plus solutions engineering) has inherited 14
customer accounts for a drone autonomy platform. Account truth is scattered
across call transcripts, emails, support tickets, internal notes, CRM records,
and monthly flight usage. Some of it contradicts itself. CRM health labels are
stale. Usage data is not.

Build a system that continuously ingests this, derives evidence-backed state per
account, ranks what the team should do next, and updates itself when the source
data changes without a human re-running anything.

## 2. The single hardest requirement

Source data changes at an unannounced point this afternoon (approximately
4:30 PM). New transcripts, emails, tickets, and usage months appear across part
of the portfolio. **At least one currently available document stops being
available.**

By 5:00 PM the system must reflect this **on its own**. No manual re-import, no
re-uploading, no re-triggering a script by hand. Judges will specifically look
for whether the system noticed, or whether a human noticed for it.

This means:
- A scheduled sync loop running from the first hour, not bolted on at 4:00.
- Content-hash diffing so unchanged data is a cheap no-op.
- **Deletion detection.** A document disappearing must invalidate the claims it
  supported, re-derive the affected account, and surface as a visible retraction.
  Most competing submissions will handle additions and miss deletions. This is
  your differentiator. Build it deliberately.
- A visible change feed and a sync heartbeat in the UI.

Design for this from the start. It is much harder to add at 4:00 than to build
in at 10:00.

## 3. Required capabilities

The system must answer these, across the whole portfolio, not one account at a
time. Each maps to a named view and an API endpoint so a judge can tick them off.

1. **Account state with evidence.** Lifecycle stage, value, people, health, open
   risks, open opportunities, and the source documents behind each.
2. **Ranked next actions.** What to do, for which account, why, ordered by what
   actually matters.
3. **Renewal and revenue picture.** Secure, at risk, already lost, and an honest
   forecast with its basis stated.
4. **Expansion opportunities and traps.** A trap is an expansion signal undercut
   by a counter signal: interest from someone with no budget authority, growth
   alongside an unresolved escalation, a departed champion. Name the counter
   signal explicitly.
5. **Winback assessment** for the two churned accounts: worth pursuing or not,
   what it would take, and why.
6. **Usage reality versus health label.** Who is flying, how much, trending
   which way, and whether that agrees with the CRM label. Disagreements are a
   headline feature, not a footnote.
7. **Self-updating.** Section 2.

## 4. Data source

Read-only MCP server, Streamable HTTP.

```
Endpoint: https://flytbase-gtm-hackathon.lovable.app/api/mcp
Auth:     Bearer token, read from MCP_TOKEN env var
```

`mcp_client.py` is provided and handles the JSON-RPC handshake, session id,
SSE parsing, content-addressed snapshotting, and a document manifest diff for
deletion detection. Start from it. Do not rewrite it from scratch.

**First action of the build:** run `python mcp_client.py discover`, write
`schema.json`, and adapt the pull loop to the real tool names. The tool names in
the snapshot function are placeholders.

**Critical:** the token is revoked when submission closes, and the dashboard may
be viewed by judges afterward. Snapshot every raw response to disk and to the
database as it arrives. The dashboard must never read live from MCP on page
load. It reads only from your own store.

Never commit the token. Read from env, gitignore `.env`.

## 5. Architecture

Layered and boring, because the failure mode today is unfinished scope, not
insufficient cleverness.

```
MCP server
    |
    v
[1] Sync worker          cron, every 5 min. Fetch all, hash, diff.
    |                    Mark accounts dirty. Detect withdrawn docs.
    v
[2] Document store       raw payloads + content_hash + fetched_at + is_present
    |
    v
[3] Extraction           per document, cheap fast model, parallel.
    |                    Outputs claims with source doc ids and confidence.
    v
[4] Detectors            pure Python, no LLM. Usage trend regression,
    |                    days since last inbound contact, renewal proximity,
    |                    ticket escalation, champion departure, label mismatch.
    v
[5] Synthesis            stronger model, dirty accounts only.
    |                    Health, risks, opportunities, traps, winback.
    v
[6] Portfolio pass       cross-account ranking, revenue rollup, forecast.
    |
    v
[7] API                  GET /api/portfolio, single state object.
    |
    v
[8] Dashboard            React, polls every 20s.
```

Claim-level provenance is what makes step 3 to 5 re-derivation cheap. When a
document changes or disappears, invalidate only the claims sourced from it, then
re-run synthesis for affected accounts only. Never re-derive the whole portfolio
on every sync.

**Stack:**
- Python 3.11, FastAPI, APScheduler or a plain cron loop for sync
- Postgres via Supabase (or SQLite if Supabase setup costs more than 15 minutes,
  decide fast and record it in `DECISIONS.md`)
- Frontend per `FRONTEND_PRD.md`
- Deploy: backend on Railway or Render, frontend on Vercel

## 6. Schema

```sql
documents(
  id, account_id, type, title, doc_date, raw_payload jsonb,
  content_hash, fetched_at, is_present bool, withdrawn_at
)
claims(
  id, account_id, field, value, confidence, source_doc_ids text[],
  extracted_at, invalidated_at, invalidation_reason
)
account_state(
  account_id, derived_health, crm_label, mismatch bool, mismatch_reason,
  stage, arr, renewal_date, payload jsonb, derived_at, is_dirty bool
)
actions(
  id, account_id, action, why, reason_codes text[], urgency int,
  bucket, source_doc_ids text[], created_at
)
change_log(
  id, at, account_id, type, description, consequence
)
```

`change_log.type` values: `document_added`, `document_withdrawn`,
`usage_updated`, `account_rederived`, `claim_invalidated`.

## 7. Output contract

The API serves exactly the shape in `fixtures/portfolio.json`. That fixture is
frozen and authoritative. Do not reshape it. The frontend is specced against it.

`GET /api/portfolio` returns the whole object. Add per-view endpoints only if
payload size becomes a real problem.

## 8. Frontend

Governed entirely by `FRONTEND_PRD.md`. Do not duplicate or reinterpret it here.
Key points that interact with the backend: 20 second polling, sync heartbeat,
change feed, withdrawn documents rendered as retractions with invalidated claim
counts, and `VITE_API_BASE` swapping fixture for live API.

## 9. Cost and model discipline

- Extraction: cheap fast model, parallelized, one call per document.
- Synthesis: stronger model, one call per dirty account, never per document.
- Detectors: zero LLM calls.
- Cache extraction results by `content_hash`. An unchanged document is never
  re-extracted.
- Record cost per full re-sync and per incremental sync in `DECISIONS.md`.

A full portfolio re-derivation on every 5 minute tick is a design failure, not
just an expense. Incremental is the requirement.

## 10. Schedule and gates

Times are fixed by the event. Work backward from them.

| By    | Gate                                                                    |
|-------|-------------------------------------------------------------------------|
| +30m  | `discover` run, `schema.json` written, real tool names known             |
| +90m  | Skeleton deployed. Frontend live on fixture. Sync loop running, logging diffs |
| +3h   | Extraction and detectors working on real data. Claims in DB with provenance |
| +4h   | Synthesis and ranking live. All seven capabilities reachable in the UI   |
| +5h   | **Verification gate 1:** human confirms an induced source change propagates end to end untouched |
| 4:00  | Human records main walkthrough video                                     |
| 4:15  | **Code freeze.** No new features. Bug fixes only                          |
| 4:25  | One-pager and repo link submitted                                        |
| 4:30  | Real data update lands. Touch nothing                                     |
| 4:40  | **Verification gate 2:** change feed populates on its own. Human records 60s addendum clip |
| 5:00  | Close                                                                    |

If you are behind at +4h, cut in this order: winback prose quality, expansion
trap nuance, visual polish. **Never cut the sync loop or deletion detection.**

## 11. Definition of done

- [ ] Runs against the real Book of Business, not sample data
- [ ] All seven capabilities in section 3 produce real output
- [ ] Sync loop runs on a schedule with no human trigger
- [ ] Document withdrawal invalidates claims and shows a visible retraction
- [ ] Every assertion traces to source documents in the UI
- [ ] Health label versus usage mismatches surfaced explicitly
- [ ] Dashboard deployed and reachable, serving from own store not live MCP
- [ ] `DECISIONS.md` and `STATUS.md` current
- [ ] No token in the repo

## 12. Out of scope

Auth, user accounts, any write path back to source, exports, mobile layout,
multi-tenancy, a chat or assistant interface, tests beyond what you need to
trust the detectors.

Do not build a conversational agent. If time remains after section 11 is fully
green, stop and report rather than starting new work.