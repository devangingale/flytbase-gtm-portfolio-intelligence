import { useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Account,
  SourceDocument,
  ActionItem,
} from '../../types/portfolio';
import { HealthBadge, StageBadge, SeverityBadge, ConfidenceIndicator } from '../common/Badge';
import { EvidenceButton } from '../common/EvidenceButton';
import { MismatchIndicator } from '../common/MismatchIndicator';
import { Sparkline } from '../common/Sparkline';
import {
  formatCurrency,
  formatDate,
  formatRole,
  daysUntil,
  formatDocType,
} from '../../utils/formatters';

interface AccountDetailViewProps {
  account: Account | null;
  allAccounts: Account[];
  documents: SourceDocument[];
  actions: ActionItem[];
  onBack: () => void;
  onSelectAccount: (accountId: string) => void;
}

export function AccountDetailView({
  account,
  allAccounts,
  documents,
  actions,
  onBack,
  onSelectAccount,
}: AccountDetailViewProps) {
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  if (!account) {
    return (
      <div className="p-12 text-center bg-terminal-surface border border-terminal-border rounded">
        <h3 className="text-sm font-mono text-terminal-muted mb-3">No account selected</h3>
        <p className="text-xs text-terminal-dim font-sans mb-4">
          Please select an account from the portfolio table or choose below:
        </p>
        <div className="flex flex-wrap gap-2 justify-center max-w-xl mx-auto">
          {allAccounts.map(a => (
            <button
              key={a.id}
              onClick={() => onSelectAccount(a.id)}
              className="px-2.5 py-1 rounded bg-terminal-panel hover:bg-slate-800 text-xs font-mono text-slate-200 border border-terminal-border"
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const accountDocs = documents.filter(d => d.account_id === account.id);
  const accountActions = actions.filter(act => act.account_id === account.id);
  const renewalDays = daysUntil(account.renewal_date);

  const toggleClaim = (claimId: string) => {
    setExpandedClaimId(prev => (prev === claimId ? null : claimId));
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Top Breadcrumb / Account Selector Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-terminal-surface p-3 rounded border border-terminal-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs font-mono text-terminal-muted hover:text-white px-2 py-1 rounded bg-terminal-panel border border-terminal-border hover:border-slate-600 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Portfolio</span>
          </button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-slate-100">{account.name}</h1>
              <span className="text-xs font-mono text-terminal-dim">({account.id})</span>
              <StageBadge stage={account.stage} />
              <HealthBadge status={account.health?.derived} size="md" />
            </div>
          </div>
        </div>

        {/* Quick Switch Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-terminal-dim">Switch:</span>
          <select
            value={account.id}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded text-xs font-mono text-slate-200 px-2 py-1 focus:outline-none focus:border-cyan-600"
          >
            {allAccounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mismatch Warning Alert if Applicable */}
      {account.health?.mismatch && (
        <MismatchIndicator health={account.health} />
      )}

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Identity, Financials, Contacts, Winback (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Identity & Core Metrics Card */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400 border-b border-terminal-border pb-1.5">
              Account Overview & Metrics
            </h2>

            <div className="grid grid-cols-2 gap-3 font-mono text-xs">
              <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border">
                <span className="text-[10px] text-terminal-dim uppercase block">Annual Recurring Revenue</span>
                <span className="text-sm font-bold text-slate-100 tabular-nums">
                  {formatCurrency(account.arr, false)}
                </span>
              </div>

              <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border">
                <span className="text-[10px] text-terminal-dim uppercase block">Renewal Date</span>
                <span className="text-sm font-bold text-slate-100">
                  {formatDate(account.renewal_date)}
                </span>
                {renewalDays !== null && (
                  <span
                    className={`text-[10px] block mt-0.5 ${
                      renewalDays <= 90 ? 'text-amber-400 font-semibold' : 'text-slate-400'
                    }`}
                  >
                    {renewalDays > 0 ? `(${renewalDays} days out)` : `(${Math.abs(renewalDays)} days ago)`}
                  </span>
                )}
              </div>

              <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border">
                <span className="text-[10px] text-terminal-dim uppercase block">Derived Health</span>
                <div className="mt-1">
                  <HealthBadge status={account.health?.derived} />
                </div>
              </div>

              <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border">
                <span className="text-[10px] text-terminal-dim uppercase block">CRM Status Label</span>
                <span className="text-xs font-semibold capitalize text-slate-300 block mt-1">
                  {account.health?.crm_label || 'Unlabeled'}
                </span>
              </div>
            </div>

            {/* Flight Usage Trend */}
            <div className="p-3 rounded bg-terminal-panel border border-terminal-border space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[10px] text-terminal-dim uppercase">Flight Usage Trend</span>
                {account.usage && (
                  <span
                    className={`font-semibold ${
                      account.usage.pct_change < 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {account.usage.pct_change > 0 ? '+' : ''}{account.usage.pct_change.toFixed(1)}% (5 mo)
                  </span>
                )}
              </div>

              {account.usage ? (
                <div className="space-y-2">
                  <div className="h-10 w-full">
                    <Sparkline usage={account.usage} height={36} showDetails />
                  </div>
                  <div className="grid grid-cols-5 gap-1 text-[10px] font-mono text-center pt-1 border-t border-terminal-border/60 text-terminal-dim">
                    {account.usage.series.map(pt => (
                      <div key={pt.month} className="p-1 rounded bg-terminal-bg/50">
                        <div className="text-slate-400">{pt.month.slice(5)}</div>
                        <div className="font-semibold text-slate-200">{pt.flight_hours}h</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs font-mono text-terminal-dim italic py-2 text-center">
                  No active flight operations recorded for this account.
                </div>
              )}
            </div>
          </div>

          {/* Key Stakeholders & Contacts Card */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-terminal-border pb-1.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
                Key Contacts ({account.contacts?.length || 0})
              </h2>
              <span className="text-[10px] font-mono text-terminal-dim">Influence & Activity</span>
            </div>

            {(!account.contacts || account.contacts.length === 0) ? (
              <div className="text-xs font-mono text-terminal-dim italic py-3 text-center">
                No recorded stakeholders.
              </div>
            ) : (
              <div className="space-y-2">
                {account.contacts.map((contact, idx) => {
                  const isGoneQuiet = contact.status === 'gone_quiet';
                  const isCold = contact.status === 'cold';

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded border transition-colors ${
                        isGoneQuiet
                          ? 'bg-rose-950/20 border-rose-800/70'
                          : isCold
                          ? 'bg-amber-950/20 border-amber-800/60'
                          : 'bg-terminal-panel border-terminal-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-slate-100">
                              {contact.name}
                            </span>
                            {isGoneQuiet && (
                              <span className="text-[9px] uppercase font-mono px-1 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold">
                                Gone Quiet
                              </span>
                            )}
                            {isCold && (
                              <span className="text-[9px] uppercase font-mono px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-semibold">
                                Cold
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-terminal-muted font-sans">
                            {contact.title}
                          </div>
                        </div>

                        <div className="text-right font-mono text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 block mb-0.5">
                            {formatRole(contact.role)}
                          </span>
                          <span className="text-terminal-dim">
                            Influence: <span className="text-slate-300 uppercase">{contact.influence}</span>
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-terminal-border/50 flex items-center justify-between text-[10px] font-mono text-terminal-dim">
                        <span>Last Contact:</span>
                        <span className={`font-semibold ${isGoneQuiet ? 'text-rose-400' : 'text-slate-300'}`}>
                          {formatDate(contact.last_contact_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Winback Assessment (If Applicable) */}
          {account.winback && (
            <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-2.5 shadow-md">
              <div className="flex items-center justify-between border-b border-terminal-border pb-1.5">
                <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
                  Winback Assessment
                </h2>
                <span
                  className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded font-bold border ${
                    account.winback.worth_pursuing
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {account.winback.worth_pursuing ? 'Worth Pursuing' : 'Do Not Pursue'}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[10px] font-mono text-terminal-dim uppercase block">Rationale</span>
                  <p className="text-slate-300 text-xs leading-relaxed mt-0.5">
                    {account.winback.rationale}
                  </p>
                </div>

                <div className="pt-2 border-t border-terminal-border">
                  <span className="text-[10px] font-mono text-terminal-dim uppercase block">Required Action & Effort</span>
                  <p className="text-slate-200 text-xs leading-relaxed mt-0.5 font-mono">
                    {account.winback.required_effort}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Stacked Panels for Risks, Opportunities, Claims, Timeline (lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Active Queued Actions on this Account */}
          {accountActions.length > 0 && (
            <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-2.5 shadow-md">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-rose-400 border-b border-terminal-border pb-1.5">
                Queued Priority Action ({accountActions.length})
              </h2>

              <div className="space-y-2">
                {accountActions.map(action => (
                  <div
                    key={action.id}
                    className="p-3 rounded bg-terminal-panel border border-terminal-border space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[9px] font-mono uppercase px-1.5 py-0.2 rounded font-bold ${
                              action.bucket === 'now'
                                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                : action.bucket === 'this_week'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {action.bucket.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[11px] font-mono font-bold text-rose-400">
                            Urgency: {action.urgency}/100
                          </span>
                        </div>
                        <h3 className="text-xs font-semibold text-slate-100">
                          {action.action}
                        </h3>
                      </div>

                      <EvidenceButton
                        title={`Action Evidence: ${action.action}`}
                        subtitle={action.why}
                        docIds={action.evidence}
                      />
                    </div>

                    <p className="text-xs text-terminal-muted leading-relaxed">
                      {action.why}
                    </p>

                    <div className="flex flex-wrap gap-1 pt-1">
                      {action.reason_codes.map(code => (
                        <span
                          key={code}
                          className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-terminal-bg text-terminal-dim border border-slate-800"
                        >
                          #{code}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open Risks Panel */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-terminal-border pb-1.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-rose-400">
                Open Risks ({account.risks?.length || 0})
              </h2>
              <span className="text-[10px] font-mono text-terminal-dim">Evidence-backed threats</span>
            </div>

            {(!account.risks || account.risks.length === 0) ? (
              <div className="text-xs font-mono text-terminal-dim italic py-3 text-center">
                No active risks detected.
              </div>
            ) : (
              <div className="space-y-2.5">
                {account.risks.map(risk => (
                  <div
                    key={risk.id}
                    className="p-3 rounded bg-terminal-panel border border-terminal-border space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={risk.severity} />
                          <span className="text-[10px] font-mono text-terminal-dim">{risk.id}</span>
                        </div>
                        <h3 className="text-xs font-semibold text-slate-100">
                          {risk.title}
                        </h3>
                      </div>

                      <EvidenceButton
                        title={`Risk Evidence: ${risk.title}`}
                        subtitle={risk.summary}
                        docIds={risk.evidence}
                      />
                    </div>

                    <p className="text-xs text-terminal-muted leading-relaxed font-sans">
                      {risk.summary}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Opportunities Panel (with Trap Warnings) */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-terminal-border pb-1.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
                Expansion Signals & Opportunities ({account.opportunities?.length || 0})
              </h2>
              <span className="text-[10px] font-mono text-terminal-dim">Pipeline & Traps</span>
            </div>

            {(!account.opportunities || account.opportunities.length === 0) ? (
              <div className="text-xs font-mono text-terminal-dim italic py-3 text-center">
                No expansion signals recorded.
              </div>
            ) : (
              <div className="space-y-2.5">
                {account.opportunities.map(opp => (
                  <div
                    key={opp.id}
                    className={`p-3 rounded border space-y-2 ${
                      opp.is_trap
                        ? 'bg-amber-950/20 border-amber-800/70'
                        : 'bg-terminal-panel border-terminal-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          {opp.is_trap ? (
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-700 font-bold">
                              TRAP SIGNAL
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
                              REAL OPPORTUNITY
                            </span>
                          )}
                          <span className="text-xs font-mono font-semibold text-emerald-400">
                            {formatCurrency(opp.value_estimate, false)} est.
                          </span>
                        </div>
                        <h3 className="text-xs font-semibold text-slate-100">
                          {opp.title}
                        </h3>
                      </div>

                      <EvidenceButton
                        title={`Opportunity Evidence: ${opp.title}`}
                        subtitle={opp.counter_signal ? `Counter-signal: ${opp.counter_signal}` : undefined}
                        docIds={opp.evidence}
                      />
                    </div>

                    {/* Counter Signal Box if Trap */}
                    {opp.is_trap && opp.counter_signal && (
                      <div className="p-2 rounded bg-amber-950/50 border border-amber-800/70 text-xs text-amber-200 flex items-start gap-2">
                        <span>{opp.counter_signal}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Derived Claims Panel (Every claim renders with evidence affordance) */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-terminal-border pb-1.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
                Derived Claims & Fact State ({account.claims?.length || 0})
              </h2>
              <span className="text-[10px] font-mono text-terminal-dim">3-State Confidence</span>
            </div>

            {(!account.claims || account.claims.length === 0) ? (
              <div className="text-xs font-mono text-terminal-dim italic py-3 text-center">
                No extracted claims for this account.
              </div>
            ) : (
              <div className="space-y-2">
                {account.claims.map(claim => {
                  const isExpanded = expandedClaimId === claim.id;
                  const supportingDocs = documents.filter(d => claim.evidence.includes(d.id));

                  return (
                    <div
                      key={claim.id}
                      className="rounded border border-terminal-border bg-terminal-panel overflow-hidden transition-all"
                    >
                      <div
                        onClick={() => toggleClaim(claim.id)}
                        className="p-3 flex items-start justify-between gap-3 cursor-pointer hover:bg-slate-800/60 select-none"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-terminal-bg text-terminal-muted border border-slate-800">
                              {claim.field.replace(/_/g, ' ')}
                            </span>
                            <ConfidenceIndicator confidence={claim.confidence} />
                          </div>
                          <p className="text-xs font-medium text-slate-100">
                            {claim.value}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <EvidenceButton
                            title={`Claim: ${claim.field}`}
                            subtitle={claim.value}
                            docIds={claim.evidence}
                            confidence={claim.confidence}
                            variant="inline"
                          />
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-cyan-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-terminal-dim" />
                          )}
                        </div>
                      </div>

                      {/* Inline Expanded Document Excerpts */}
                      {isExpanded && (
                        <div className="p-3 bg-terminal-bg border-t border-terminal-border space-y-2">
                          <div className="text-[10px] font-mono text-terminal-dim uppercase">
                            Direct Source Quotes:
                          </div>
                          {supportingDocs.length === 0 ? (
                            <div className="text-xs font-mono text-terminal-muted">
                              Referenced docs: {claim.evidence.join(', ')}
                            </div>
                          ) : (
                            supportingDocs.map(doc => (
                              <div
                                key={doc.id}
                                className={`p-2 rounded border text-xs font-mono space-y-1 ${
                                  doc.status === 'withdrawn'
                                    ? 'bg-rose-950/20 border-rose-800/60 line-through text-rose-300/80'
                                    : 'bg-terminal-panel border-slate-800 text-slate-300'
                                }`}
                              >
                                <div className="flex items-center justify-between text-[10px] text-terminal-dim">
                                  <span>{doc.id} ({formatDocType(doc.type)}) - {formatDate(doc.date)}</span>
                                  {doc.status === 'withdrawn' && (
                                    <span className="text-rose-400 font-bold uppercase">Retracted</span>
                                  )}
                                </div>
                                <div>"{doc.excerpt}"</div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Timeline of Source Documents */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-terminal-border pb-1.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
                Source Document Timeline ({accountDocs.length})
              </h2>
              <span className="text-[10px] font-mono text-terminal-dim">Deterministic Audit</span>
            </div>

            {accountDocs.length === 0 ? (
              <div className="text-xs font-mono text-terminal-dim italic py-3 text-center">
                No source documents linked to this account ID.
              </div>
            ) : (
              <div className="space-y-2.5">
                {accountDocs.map(doc => {
                  const isWithdrawn = doc.status === 'withdrawn';

                  return (
                    <div
                      key={doc.id}
                      className={`p-3 rounded border text-xs space-y-1.5 ${
                        isWithdrawn
                          ? 'bg-rose-950/20 border-rose-800/70'
                          : 'bg-terminal-panel border-terminal-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold text-terminal-dim">{doc.id}</span>
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {formatDocType(doc.type)}
                            </span>
                            {isWithdrawn && (
                              <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold">
                                RETRACTED
                              </span>
                            )}
                          </div>
                          <h3
                            className={`text-xs font-semibold ${
                              isWithdrawn ? 'text-rose-200/80 line-through' : 'text-slate-100'
                            }`}
                          >
                            {doc.title}
                          </h3>
                        </div>

                        <span className="text-[10px] font-mono text-terminal-dim shrink-0">
                          {formatDate(doc.date)}
                        </span>
                      </div>

                      <p
                        className={`text-xs font-mono p-2 rounded ${
                          isWithdrawn
                            ? 'bg-rose-950/40 text-rose-300/80 line-through border border-rose-900'
                            : 'bg-terminal-bg text-slate-300 border border-slate-800'
                        }`}
                      >
                        "{doc.excerpt}"
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
