import {
  AlertTriangle,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
  Target,
} from 'lucide-react';
import { Account, Opportunity } from '../../types/portfolio';
import { EvidenceButton } from '../common/EvidenceButton';
import { formatCurrency } from '../../utils/formatters';

interface ExpansionViewProps {
  accounts: Account[];
  onSelectAccount: (accountId: string) => void;
}

interface FlattenedOpportunity extends Opportunity {
  account: Account;
}

export function ExpansionView({ accounts, onSelectAccount }: ExpansionViewProps) {
  // Extract all opportunities across accounts
  const realOpportunities: FlattenedOpportunity[] = [];
  const traps: FlattenedOpportunity[] = [];

  for (const account of accounts) {
    if (!account.opportunities) continue;
    for (const opp of account.opportunities) {
      if (opp.is_trap) {
        traps.push({ ...opp, account });
      } else {
        realOpportunities.push({ ...opp, account });
      }
    }
  }

  // Calculate totals
  const realTotalValue = realOpportunities.reduce((sum, o) => sum + (o.value_estimate || 0), 0);
  const trapTotalValue = traps.reduce((sum, o) => sum + (o.value_estimate || 0), 0);

  // Churned accounts with winback assessments
  const churnedAccounts = accounts.filter(
    a => a.stage === 'churned' || (a.winback && a.winback.applicable)
  );

  return (
    <div className="space-y-5 font-sans">
      {/* Top Banner */}
      <div className="bg-terminal-surface border border-terminal-border p-3.5 rounded flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div>
          <h1 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-400" />
            Expansion Radar & Signal Validation
          </h1>
          <p className="text-xs text-terminal-muted mt-0.5">
            Differentiating genuine expansion pipeline from traps undercut by counter signals.
          </p>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-emerald-400">
            Validated Pipeline: <strong>{formatCurrency(realTotalValue, false)}</strong>
          </span>
          <span className="text-terminal-dim">|</span>
          <span className="text-amber-400">
            Trap Risk: <strong>{formatCurrency(trapTotalValue, false)}</strong>
          </span>
        </div>
      </div>

      {/* Two Side-by-Side Columns: Real Opportunities vs Traps (Section 5.5) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Column: Real Opportunities */}
        <div className="space-y-3">
          <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-300">
                Real Opportunities ({realOpportunities.length})
              </h2>
            </div>
            <span className="font-mono text-xs font-bold text-emerald-400">
              {formatCurrency(realTotalValue, false)}
            </span>
          </div>

          {realOpportunities.length === 0 ? (
            <div className="p-8 bg-terminal-surface border border-dashed border-terminal-border rounded text-center text-xs font-mono text-terminal-dim">
              No unencumbered expansion opportunities recorded.
            </div>
          ) : (
            <div className="space-y-3">
              {realOpportunities.map(opp => (
                <div
                  key={opp.id}
                  className="bg-terminal-surface border border-emerald-900/50 hover:border-emerald-700/80 rounded p-4 space-y-3 transition-all shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        onClick={() => onSelectAccount(opp.account.id)}
                        className="text-sm font-bold text-slate-100 hover:text-cyan-400 transition-colors flex items-center gap-1.5 text-left"
                      >
                        <span>{opp.account.name}</span>
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                      </button>

                      <div className="flex items-center gap-2 mt-0.5 text-[11px] font-mono text-terminal-dim">
                        <span>{opp.account.id}</span>
                        <span>•</span>
                        <span className="text-slate-300">{formatCurrency(opp.account.arr, false)} base ARR</span>
                      </div>
                    </div>

                    <EvidenceButton
                      title={`Opportunity: ${opp.title}`}
                      subtitle={`Account: ${opp.account.name} (${opp.account.id})`}
                      docIds={opp.evidence}
                    />
                  </div>

                  <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-100">{opp.title}</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      +{formatCurrency(opp.value_estimate, false)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-terminal-dim pt-1 border-t border-terminal-border/50">
                    <span className="text-emerald-400 font-semibold uppercase text-[10px]">
                      High Intent Signal Verified
                    </span>
                    <span>{opp.evidence.length} supporting doc{opp.evidence.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Traps */}
        <div className="space-y-3">
          <div className="p-3 rounded bg-amber-950/30 border border-amber-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-amber-300">
                Traps & False Expansion Signals ({traps.length})
              </h2>
            </div>
            <span className="font-mono text-xs font-bold text-amber-400">
              {formatCurrency(trapTotalValue, false)}
            </span>
          </div>

          {traps.length === 0 ? (
            <div className="p-8 bg-terminal-surface border border-dashed border-terminal-border rounded text-center text-xs font-mono text-terminal-dim">
              No trap expansion signals detected.
            </div>
          ) : (
            <div className="space-y-3">
              {traps.map(opp => (
                <div
                  key={opp.id}
                  className="bg-terminal-surface border border-amber-900/60 hover:border-amber-700/80 rounded p-4 space-y-3 transition-all shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        onClick={() => onSelectAccount(opp.account.id)}
                        className="text-sm font-bold text-slate-100 hover:text-cyan-400 transition-colors flex items-center gap-1.5 text-left"
                      >
                        <span>{opp.account.name}</span>
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                      </button>

                      <div className="flex items-center gap-2 mt-0.5 text-[11px] font-mono text-terminal-dim">
                        <span>{opp.account.id}</span>
                        <span>•</span>
                        <span className="text-slate-300">{formatCurrency(opp.account.arr, false)} base ARR</span>
                      </div>
                    </div>

                    <EvidenceButton
                      title={`Trap Opportunity: ${opp.title}`}
                      subtitle={`Counter Signal: ${opp.counter_signal}`}
                      docIds={opp.evidence}
                      hasRetractedDoc
                    />
                  </div>

                  {/* Stated Expansion Idea */}
                  <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">{opp.title}</span>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      +{formatCurrency(opp.value_estimate, false)} est.
                    </span>
                  </div>

                  {/* Explicit Counter Signal Warning Box (PRD Requirement 5.5) */}
                  <div className="p-3 rounded bg-amber-950/60 border border-amber-800 text-xs text-amber-200 font-sans space-y-1">
                    <div className="flex items-center gap-1.5 font-mono font-bold text-[10px] uppercase text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Counter Signal Undercutting Opportunity:</span>
                    </div>
                    <p className="leading-relaxed">
                      {opp.counter_signal}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Churned Accounts Winback Assessment Section (PRD Requirement 5.5) */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md mt-6">
        <div className="flex items-center justify-between border-b border-terminal-border pb-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100">
              Churned Accounts & Winback Assessments ({churnedAccounts.length})
            </h2>
          </div>
          <span className="text-[10px] font-mono text-terminal-dim">Recovery Feasibility</span>
        </div>

        {churnedAccounts.length === 0 ? (
          <div className="text-xs font-mono text-terminal-dim italic py-3 text-center">
            No churned accounts recorded.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {churnedAccounts.map(account => {
              const wb = account.winback;
              return (
                <div
                  key={account.id}
                  className="p-3.5 rounded bg-terminal-panel border border-terminal-border space-y-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        onClick={() => onSelectAccount(account.id)}
                        className="text-sm font-bold text-slate-100 hover:text-cyan-400 transition-colors flex items-center gap-1.5"
                      >
                        <span>{account.name}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                      <div className="text-[11px] font-mono text-terminal-dim mt-0.5">
                        {account.id} • Lost ARR: <span className="text-rose-400 font-semibold">{formatCurrency(account.arr, false)}</span>
                      </div>
                    </div>

                    {wb && (
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold border ${
                          wb.worth_pursuing
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                        }`}
                      >
                        {wb.worth_pursuing ? 'Worth Pursuing: YES' : 'Worth Pursuing: NO'}
                      </span>
                    )}
                  </div>

                  {wb ? (
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-[10px] font-mono text-terminal-dim uppercase block">Rationale</span>
                        <p className="text-slate-300 text-xs leading-relaxed mt-0.5 font-sans">
                          {wb.rationale}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-terminal-border/60">
                        <span className="text-[10px] font-mono text-terminal-dim uppercase block">What It Would Take / Estimated Effort</span>
                        <p className="text-slate-200 text-xs leading-relaxed mt-0.5 font-mono">
                          {wb.required_effort}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs font-mono text-terminal-dim italic">
                      No winback assessment on file.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
