import {
  GitCompare,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
} from 'lucide-react';
import { Account } from '../../types/portfolio';
import { HealthBadge, StageBadge } from '../common/Badge';
import { Sparkline } from '../common/Sparkline';
import { formatCurrency } from '../../utils/formatters';

interface SignalVsLabelViewProps {
  accounts: Account[];
  onSelectAccount: (accountId: string) => void;
}

export function SignalVsLabelView({ accounts, onSelectAccount }: SignalVsLabelViewProps) {
  // Disagreeing accounts float to the top
  const mismatchedAccounts = accounts.filter(a => a.health?.mismatch);
  const alignedAccounts = accounts.filter(a => !a.health?.mismatch);

  return (
    <div className="space-y-5 font-sans">
      {/* View Header Banner */}
      <div className="bg-terminal-surface border border-terminal-border p-3.5 rounded flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div>
          <h1 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-amber-400" />
            Signal vs CRM Label Reconciliation
          </h1>
          <p className="text-xs text-terminal-muted mt-0.5">
            Operational usage telemetry contrasted against static CRM health tags.
          </p>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-amber-400 font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {mismatchedAccounts.length} Discrepanc{mismatchedAccounts.length === 1 ? 'y' : 'ies'} Detected
          </span>
          <span className="text-terminal-dim">|</span>
          <span className="text-slate-400">
            {alignedAccounts.length} Aligned
          </span>
        </div>
      </div>

      {/* Top Section: Mismatch Spotlight Cards (Floating to the Top) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-amber-300">
            Health Discrepancies ({mismatchedAccounts.length})
          </h2>
        </div>

        {mismatchedAccounts.length === 0 ? (
          <div className="p-6 bg-terminal-surface border border-dashed border-terminal-border rounded text-center text-xs font-mono text-terminal-dim">
            All account CRM labels are currently aligned with derived usage signals.
          </div>
        ) : (
          <div className="space-y-3">
            {mismatchedAccounts.map(account => (
              <div
                key={account.id}
                className="bg-terminal-surface border-2 border-amber-800/80 rounded p-4 space-y-3 shadow-lg hover:border-amber-600 transition-colors"
              >
                {/* Top Row: Account & Financials */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <button
                      onClick={() => onSelectAccount(account.id)}
                      className="text-base font-bold text-slate-100 hover:text-cyan-400 transition-colors flex items-center gap-2 text-left"
                    >
                      <span>{account.name}</span>
                      <ArrowRight className="w-4 h-4 text-slate-500" />
                    </button>

                    <div className="flex items-center gap-2 mt-0.5 text-xs font-mono text-terminal-dim">
                      <span>{account.id}</span>
                      <span>•</span>
                      <span className="text-slate-300 font-semibold">{formatCurrency(account.arr, false)} ARR</span>
                      <span>•</span>
                      <StageBadge stage={account.stage} />
                    </div>
                  </div>

                  {/* Contrast Pills */}
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <div className="p-2 rounded bg-terminal-panel border border-terminal-border text-center">
                      <span className="text-[10px] uppercase text-terminal-dim block">CRM Label</span>
                      <span className="font-semibold text-slate-300 capitalize">{account.health.crm_label}</span>
                    </div>

                    <div className="text-terminal-dim font-bold">vs</div>

                    <div className="p-2 rounded bg-terminal-panel border border-amber-800/60 text-center">
                      <span className="text-[10px] uppercase text-amber-400 block">Derived Health</span>
                      <span className="font-semibold text-amber-300 capitalize">{account.health.derived.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                </div>

                {/* Prominent Disagreement Statement (Visual Subject) */}
                <div className="p-3 rounded bg-amber-950/60 border border-amber-700/80 space-y-1">
                  <div className="text-[10px] font-mono uppercase font-bold text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Disagreement Analysis:</span>
                  </div>
                  <p className="text-sm font-semibold text-amber-100 leading-snug font-sans">
                    "{account.health.mismatch_reason || 'CRM recorded status contradicts real usage and contact patterns.'}"
                  </p>
                </div>

                {/* Flight Usage Data Breakdown */}
                {account.usage && (
                  <div className="p-3 rounded bg-terminal-panel border border-terminal-border space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[10px] uppercase text-terminal-dim">5-Month Flight Activity</span>
                      <span className="font-bold text-rose-400">
                        {account.usage.pct_change.toFixed(1)}% ({account.usage.trend})
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-2 text-center text-xs font-mono">
                      {account.usage.series.map(pt => (
                        <div key={pt.month} className="p-2 rounded bg-terminal-bg border border-slate-800">
                          <div className="text-[10px] text-slate-500">{pt.month}</div>
                          <div className="font-bold text-slate-200 mt-0.5">{pt.flight_hours} hrs</div>
                          <div className="text-[10px] text-terminal-dim">{pt.missions} missions</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Section: Aligned Accounts List */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md">
        <div className="flex items-center justify-between border-b border-terminal-border pb-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100">
              Aligned Accounts ({alignedAccounts.length})
            </h2>
          </div>
          <span className="text-[10px] font-mono text-terminal-dim">Signal matches CRM</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead>
              <tr className="bg-terminal-panel text-terminal-dim font-mono text-[10px] uppercase border-b border-terminal-border">
                <th className="py-2 px-3">Account</th>
                <th className="py-2 px-2">Stage</th>
                <th className="py-2 px-3 text-right">ARR</th>
                <th className="py-2 px-3">CRM Label</th>
                <th className="py-2 px-3">Derived Health</th>
                <th className="py-2 px-3">Usage Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/50 font-mono">
              {alignedAccounts.map(account => (
                <tr
                  key={account.id}
                  onClick={() => onSelectAccount(account.id)}
                  className="hover:bg-terminal-hover cursor-pointer transition-colors"
                >
                  <td className="py-2 px-3 font-semibold text-slate-200 hover:text-cyan-300 font-sans">
                    {account.name}
                  </td>
                  <td className="py-2 px-2">
                    <StageBadge stage={account.stage} />
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-200">
                    {formatCurrency(account.arr, false)}
                  </td>
                  <td className="py-2 px-3 capitalize text-terminal-muted">
                    {account.health?.crm_label || 'none'}
                  </td>
                  <td className="py-2 px-3">
                    <HealthBadge status={account.health?.derived} />
                  </td>
                  <td className="py-2 px-3">
                    <Sparkline usage={account.usage} showDetails />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
