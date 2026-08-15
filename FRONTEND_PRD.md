# PRD: GTM Portfolio Command Center (Frontend)

**Owner of this doc:** backend/ingestion engineer
**Built by:** Antigravity agent
**Scope:** frontend only. You do not touch data ingestion, extraction, or scoring.

---

## 1. Context

A GTM team (customer success plus solutions engineering) manages 14 customer
accounts for a drone autonomy platform. Account information is scattered across
call transcripts, emails, support tickets, internal notes, CRM records, and
monthly flight usage data. A backend pipeline (already being built, not your
concern) ingests all of it, extracts evidence-linked claims, runs deterministic
detectors, and produces a single derived state object.

Your job: build the interface that turns that state object into something a GTM
team can act on in under 60 seconds.

**Judges will evaluate this live.** Assume someone who has never seen the app
opens it cold and needs to answer "what should I do first and why" immediately.

---

## 2. Hard constraints

1. **Build against `fixtures/portfolio.json` only.** It is the frozen contract.
   Do not invent fields. Do not reshape it. If something you need is missing,
   flag it, do not add it silently.
2. **Single data source.** The entire app reads one endpoint:
   `GET /api/portfolio` returning exactly the fixture shape. During development,
   read the local fixture. Behind one env flag (`VITE_API_BASE`), read live.
3. **Poll every 20 seconds.** Not on mount only. The app must visibly reflect
   backend changes without a user refresh. This is the single most important
   behavior in the product (see section 4).
4. **Every derived statement shows its evidence.** No number, label, or
   recommendation appears without a path to the source documents behind it.
   Unsourced UI is a failed requirement, not a polish item.
5. **No em dashes in any copy, label, or generated text.** Use commas, colons,
   or parentheses.

---

## 3. Stack

- React 18 + Vite + TypeScript
- Tailwind CSS
- Recharts (usage trend lines and sparklines only)
- lucide-react for icons
- No component library, no state management library. React state and a single
  `usePortfolio()` polling hook is enough.
- Deploy target: Vercel. Ship a deployable build early, do not leave deploy to
  the end.

---

## 4. The defining behavior: live update

The backend re-syncs its source data on a schedule. At an unannounced point,
new documents will land and at least one existing document will be withdrawn.
The app must show this happening on its own.

Requirements:

- A persistent **sync heartbeat** in the header: "Synced 14s ago", turning amber
  past 90 seconds and red past 300 seconds.
- A **Change Feed** view (section 5.7) that lists what changed, newest first.
- When a poll returns new `change_feed` entries, briefly highlight the affected
  account rows in the portfolio table (a 3 second background flash, not a modal,
  not a toast that needs dismissing).
- Withdrawn documents render distinctly: struck through, with a "retracted"
  badge, plus the count of claims invalidated by the withdrawal.

If a judge sits on the dashboard doing nothing and the backend updates, they
must see it change. Design for that moment.

---

## 5. Views

One left sidebar, seven destinations. Order matters, it mirrors how the team
thinks.

### 5.1 Portfolio (default view)
Dense table, all 14 accounts, scannable in one screen without scrolling if
possible. Columns: account name, lifecycle stage, ARR, health (derived), health
(CRM label), a usage sparkline, open risk count, next action summary.

Where derived health and CRM label disagree, the row carries a visible mismatch
marker. This is a deliberate product feature, not an error state. See 5.6.

Sortable by ARR, health, and risk count. Filter chips by lifecycle stage.

### 5.2 Account detail
Reached by clicking a row. Left column: identity, stage, ARR, renewal date,
contacts (with role, influence, and last contact date, showing who has gone
quiet). Right column: stacked panels for risks, opportunities, and timeline of
source documents.

**Every claim renders with an evidence affordance.** Clicking a claim expands
the source documents that support it, showing type, title, date, and the
supporting excerpt. Confidence renders as a small three-state indicator (high,
medium, low), not a percentage.

### 5.3 Priority queue
The ranked list of what to do next across the whole portfolio. Each card shows:
account, action, why (reason codes, plain language), urgency score, and the
evidence link. Grouped into Now, This Week, and Watch.

This view answers "what do I do first". It should be the one a judge screenshots.

### 5.4 Renewal and revenue
Renewals on a timeline by month. Each bucket splits into secure, at risk, and
lost, with ARR totals. A summary strip at top: total ARR, secure ARR, at risk
ARR, already lost ARR, and a forecast figure with the confidence basis stated
in one line.

### 5.5 Expansion
Two columns, deliberately side by side: **Real opportunities** and **Traps**.
A trap is an expansion signal undercut by a counter signal (interest voiced by
someone with no budget authority, growth alongside an unresolved escalation, a
champion who has left). Each trap card names the counter signal explicitly.

Also on this view: the two churned accounts, each with a winback assessment
(worth pursuing yes/no, what it would take, estimated effort).

### 5.6 Signal vs label
The reconciliation view. For every account, actual flight usage trend plotted
against the CRM health label. Accounts where these disagree float to the top
with the disagreement stated in one sentence, for example: "CRM says healthy,
flight hours down 43% over three months."

This view exists because CRM labels are stale and usage is not. Make the
disagreement the visual subject, not a footnote.

### 5.7 Change feed
Reverse chronological log of everything the system noticed on its own. Entry
types: document added, document withdrawn, usage updated, account re-derived,
claim invalidated. Each entry shows timestamp, account, what changed, and what
the system concluded differently as a result.

Withdrawn documents and invalidated claims are the highlight of this view.
Render them prominently.

---

## 6. Data contract

The full shape is in `fixtures/portfolio.json`, which is authoritative. Summary:

```
{
  meta: { generated_at, last_sync_at, sync_status, source_doc_count },
  totals: { arr_total, arr_secure, arr_at_risk, arr_lost, forecast, forecast_basis },
  accounts: [{
    id, name, stage, arr, renewal_date,
    health: { derived, crm_label, mismatch, mismatch_reason },
    contacts: [{ name, title, role, influence, last_contact_at, status }],
    usage: { trend, pct_change, series: [{ month, flight_hours, missions }] },
    risks:  [{ id, title, severity, summary, evidence: [doc_id] }],
    opportunities: [{ id, title, value_estimate, is_trap, counter_signal, evidence: [doc_id] }],
    claims: [{ id, field, value, confidence, evidence: [doc_id] }],
    winback: { applicable, worth_pursuing, rationale, required_effort } | null
  }],
  actions: [{ id, account_id, action, why, reason_codes, urgency, bucket, evidence: [doc_id] }],
  documents: [{ id, account_id, type, title, date, excerpt, status }],
  change_feed: [{ id, at, account_id, type, description, consequence }]
}
```

Notes:
- `evidence` arrays hold `document.id` values. Resolve against `documents`.
- `document.status` is `"active"` or `"withdrawn"`.
- `usage` is `null` for accounts not actively flying. Handle that, do not crash.
- `winback` is `null` for non-churned accounts.
- Field set is fixed. Values in the fixture are illustrative, not real.

---

## 7. Design direction

Operational tool, not a marketing page. Dense, calm, high information per pixel.
Dark background with restrained accent color. Real type hierarchy, tabular
numerals for all figures. No gradients, no glassmorphism, no oversized hero
sections, no decorative empty space.

The visual weight should sit on the numbers and the evidence, not on the
chrome. Think trading terminal, not SaaS landing page.

---

## 8. Definition of done

- [ ] All seven views render from the fixture with no console errors
- [ ] Polling works, heartbeat updates, change feed appends without refresh
- [ ] Every risk, opportunity, action, and claim exposes its source documents
- [ ] Withdrawn documents render as retracted with invalidated claim counts
- [ ] Label vs usage mismatches are visible in both Portfolio and Signal vs Label
- [ ] Accounts with `usage: null` and `winback: null` render cleanly
- [ ] Deployed to Vercel, live URL shared
- [ ] `VITE_API_BASE` swaps fixture for live API with no other code change

## 9. Explicitly out of scope

Auth, user accounts, write actions of any kind, editing, exports, a chat
interface, mobile layout below 1024px, dark/light toggle, animations beyond the
3 second change highlight.

Do not build a chat or assistant panel. That is being built separately.
