import { useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Calendar,
  Info,
} from 'lucide-react';
import { Totals, Account } from '../../types/portfolio';
import { HealthBadge } from '../common/Badge';
import { formatCurrency, formatDate } from '../../utils/formatters';

interface RenewalRevenueViewProps {
  totals: Totals;
  accounts: Account[];
  onSelectAccount: (accountId: string) => void;
}

interface MonthBucket {
  monthKey: string; // e.g. "2026-11" or "Unscheduled"
  displayMonth: string; // e.g. "Nov 2026"
  secureArr: number;
  atRiskArr: number;
  lostArr: number;
  totalArr: number;
  secureAccounts: Account[];
  atRiskAccounts: Account[];
  lostAccounts: Account[];
}

export function RenewalRevenueView({
  totals,
  accounts,
  onSelectAccount,
}: RenewalRevenueViewProps) {
  // Group accounts by renewal month
  const monthlyBuckets = useMemo(() => {
    const map = new Map<string, MonthBucket>();

    for (const acct of accounts) {
      let key = 'Unscheduled';
      let display = 'Unscheduled / Prospect';

      if (acct.renewal_date) {
        key = acct.renewal_date.slice(0, 7); // "YYYY-MM"
        try {
          const d = new Date(acct.renewal_date);
          display = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } catch {
          display = key;
        }
      }

      if (!map.has(key)) {
        map.set(key, {
          monthKey: key,
          displayMonth: display,
          secureArr: 0,
          atRiskArr: 0,
          lostArr: 0,
          totalArr: 0,
          secureAccounts: [],
          atRiskAccounts: [],
          lostAccounts: [],
        });
      }

      const bucket = map.get(key)!;
      const derived = acct.health?.derived?.toLowerCase() || '';

      if (derived === 'lost' || derived === 'churned' || acct.stage === 'churned') {
        bucket.lostArr += acct.arr || 0;
        bucket.lostAccounts.push(acct);
      } else if (derived === 'at_risk' || derived === 'critical') {
        bucket.atRiskArr += acct.arr || 0;
        bucket.atRiskAccounts.push(acct);
      } else {
        bucket.secureArr += acct.arr || 0;
        bucket.secureAccounts.push(acct);
      }

      bucket.totalArr += acct.arr || 0;
    }

    // Sort buckets by date ascending
    const sorted = Array.from(map.values()).sort((a, b) => {
      if (a.monthKey === 'Unscheduled') return 1;
      if (b.monthKey === 'Unscheduled') return -1;
      return a.monthKey.localeCompare(b.monthKey);
    });

    return sorted;
  }, [accounts]);

  return (
    <div className="space-y-4 font-sans">
      {/* Top Summary Metric Strip (PRD Requirement 5.4) */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-xl">
        <div className="flex items-center justify-between border-b border-terminal-border pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            <h1 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100">
              Portfolio ARR & Renewal Forecast Strip
            </h1>
          </div>
          <span className="text-[10px] font-mono text-terminal-dim">Tabular Financial State</span>
        </div>

        {/* 5-Column Financial Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 font-mono">
          {/* Total ARR */}
          <div className="p-3 rounded bg-terminal-panel border border-terminal-border">
            <div className="flex items-center justify-between text-[10px] uppercase text-terminal-dim">
              <span>Total ARR</span>
              <DollarSign className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-lg font-bold text-slate-100 tabular-nums mt-1">
              {formatCurrency(totals.arr_total, false)}
            </div>
            <div className="text-[10px] text-terminal-dim mt-0.5">100% portfolio base</div>
          </div>

          {/* Secure ARR */}
          <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800/60">
            <div className="flex items-center justify-between text-[10px] uppercase text-emerald-400">
              <span>Secure ARR</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-lg font-bold text-emerald-300 tabular-nums mt-1">
              {formatCurrency(totals.arr_secure, false)}
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5 font-mono">
              {totals.arr_total > 0 ? ((totals.arr_secure / totals.arr_total) * 100).toFixed(0) : 0}% of portfolio
            </div>
          </div>

          {/* At Risk ARR */}
          <div className="p-3 rounded bg-amber-950/30 border border-amber-800/60">
            <div className="flex items-center justify-between text-[10px] uppercase text-amber-400">
              <span>At Risk ARR</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-lg font-bold text-amber-300 tabular-nums mt-1">
              {formatCurrency(totals.arr_at_risk, false)}
            </div>
            <div className="text-[10px] text-amber-400/80 mt-0.5 font-mono">
              {totals.arr_total > 0 ? ((totals.arr_at_risk / totals.arr_total) * 100).toFixed(0) : 0}% exposed
            </div>
          </div>

          {/* Lost ARR */}
          <div className="p-3 rounded bg-rose-950/30 border border-rose-800/60">
            <div className="flex items-center justify-between text-[10px] uppercase text-rose-400">
              <span>Already Lost ARR</span>
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-lg font-bold text-rose-300 tabular-nums mt-1">
              {formatCurrency(totals.arr_lost, false)}
            </div>
            <div className="text-[10px] text-rose-400/80 mt-0.5 font-mono">
              {totals.arr_total > 0 ? ((totals.arr_lost / totals.arr_total) * 100).toFixed(0) : 0}% churned
            </div>
          </div>

          {/* Weighted Forecast */}
          <div className="p-3 rounded bg-cyan-950/30 border border-cyan-800/60 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[10px] uppercase text-cyan-400">
              <span>Weighted Forecast</span>
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-lg font-bold text-cyan-300 tabular-nums mt-1">
              {formatCurrency(totals.forecast, false)}
            </div>
            <div className="text-[10px] text-cyan-400/80 mt-0.5">Model output</div>
          </div>
        </div>

        {/* Forecast Basis Line (PRD: "confidence basis stated in one line") */}
        <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border flex items-start gap-2 text-xs">
          <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-mono font-bold text-cyan-300 text-[11px] uppercase mr-1.5">
              Forecast Basis:
            </span>
            <span className="text-slate-300 font-sans leading-relaxed">
              {totals.forecast_basis}
            </span>
          </div>
        </div>
      </div>

      {/* Monthly Timeline Buckets */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-cyan-400" />
            Renewal Timeline & Cohort Split
          </h2>
          <div className="flex items-center gap-3 text-[11px] font-mono text-terminal-dim">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Secure
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> At Risk
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-400" /> Lost
            </span>
          </div>
        </div>

        {monthlyBuckets.map((bucket) => {
          const totalCohortArr = bucket.secureArr + bucket.atRiskArr + bucket.lostArr;
          const securePct = totalCohortArr > 0 ? (bucket.secureArr / totalCohortArr) * 100 : 0;
          const atRiskPct = totalCohortArr > 0 ? (bucket.atRiskArr / totalCohortArr) * 100 : 0;
          const lostPct = totalCohortArr > 0 ? (bucket.lostArr / totalCohortArr) * 100 : 0;

          return (
            <div
              key={bucket.monthKey}
              className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3 shadow-md"
            >
              {/* Month Header & Cohort Subtotals */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-terminal-border pb-2">
                <div className="flex items-center gap-3">
                  <div className="px-2.5 py-1 rounded bg-terminal-panel border border-terminal-border font-mono font-bold text-sm text-slate-100">
                    {bucket.displayMonth}
                  </div>
                  <span className="text-xs font-mono text-terminal-dim">
                    Total Bucket ARR: <span className="text-slate-100 font-bold">{formatCurrency(bucket.totalArr, false)}</span>
                  </span>
                </div>

                {/* Subtotals Strip */}
                <div className="flex items-center gap-3 font-mono text-xs">
                  <span className="text-emerald-400">
                    Secure: <strong>{formatCurrency(bucket.secureArr, false)}</strong>
                  </span>
                  <span className="text-terminal-dim">|</span>
                  <span className="text-amber-400">
                    At Risk: <strong>{formatCurrency(bucket.atRiskArr, false)}</strong>
                  </span>
                  {bucket.lostArr > 0 && (
                    <>
                      <span className="text-terminal-dim">|</span>
                      <span className="text-rose-400">
                        Lost: <strong>{formatCurrency(bucket.lostArr, false)}</strong>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Visual Split Ratio Bar */}
              {totalCohortArr > 0 && (
                <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden flex">
                  {securePct > 0 && (
                    <div
                      style={{ width: `${securePct}%` }}
                      className="h-full bg-emerald-500 transition-all"
                      title={`Secure: ${securePct.toFixed(0)}%`}
                    />
                  )}
                  {atRiskPct > 0 && (
                    <div
                      style={{ width: `${atRiskPct}%` }}
                      className="h-full bg-amber-500 transition-all"
                      title={`At Risk: ${atRiskPct.toFixed(0)}%`}
                    />
                  )}
                  {lostPct > 0 && (
                    <div
                      style={{ width: `${lostPct}%` }}
                      className="h-full bg-rose-500 transition-all"
                      title={`Lost: ${lostPct.toFixed(0)}%`}
                    />
                  )}
                </div>
              )}

              {/* 3 Columns: Secure Accounts, At Risk Accounts, Lost Accounts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* Secure Column */}
                <div className="p-2.5 rounded bg-terminal-panel/60 border border-emerald-900/40 space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase text-emerald-400 font-semibold border-b border-emerald-950 pb-1">
                    <span>Secure Accounts ({bucket.secureAccounts.length})</span>
                    <span>{formatCurrency(bucket.secureArr, false)}</span>
                  </div>

                  {bucket.secureAccounts.length === 0 ? (
                    <div className="text-[11px] font-mono text-terminal-dim py-2 italic text-center">
                      None
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {bucket.secureAccounts.map(acct => (
                        <div
                          key={acct.id}
                          onClick={() => onSelectAccount(acct.id)}
                          className="p-2 rounded bg-terminal-surface hover:bg-slate-800 border border-terminal-border cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200 hover:text-cyan-300">
                              {acct.name}
                            </span>
                            <span className="font-mono text-xs font-bold text-emerald-400">
                              {formatCurrency(acct.arr, false)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-terminal-dim mt-1">
                            <span>Renewal: {formatDate(acct.renewal_date)}</span>
                            <HealthBadge status={acct.health?.derived} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* At Risk Column */}
                <div className="p-2.5 rounded bg-terminal-panel/60 border border-amber-900/40 space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase text-amber-400 font-semibold border-b border-amber-950 pb-1">
                    <span>At Risk Accounts ({bucket.atRiskAccounts.length})</span>
                    <span>{formatCurrency(bucket.atRiskArr, false)}</span>
                  </div>

                  {bucket.atRiskAccounts.length === 0 ? (
                    <div className="text-[11px] font-mono text-terminal-dim py-2 italic text-center">
                      None
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {bucket.atRiskAccounts.map(acct => (
                        <div
                          key={acct.id}
                          onClick={() => onSelectAccount(acct.id)}
                          className="p-2 rounded bg-terminal-surface hover:bg-slate-800 border border-amber-800/40 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200 hover:text-cyan-300">
                              {acct.name}
                            </span>
                            <span className="font-mono text-xs font-bold text-amber-400">
                              {formatCurrency(acct.arr, false)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-terminal-dim mt-1">
                            <span>Renewal: {formatDate(acct.renewal_date)}</span>
                            <HealthBadge status={acct.health?.derived} />
                          </div>
                          {acct.health?.mismatch_reason && (
                            <p className="text-[10px] text-amber-300/80 mt-1 line-clamp-1">
                              {acct.health.mismatch_reason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lost Column */}
                <div className="p-2.5 rounded bg-terminal-panel/60 border border-rose-900/40 space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase text-rose-400 font-semibold border-b border-rose-950 pb-1">
                    <span>Lost / Churned ({bucket.lostAccounts.length})</span>
                    <span>{formatCurrency(bucket.lostArr, false)}</span>
                  </div>

                  {bucket.lostAccounts.length === 0 ? (
                    <div className="text-[11px] font-mono text-terminal-dim py-2 italic text-center">
                      None
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {bucket.lostAccounts.map(acct => (
                        <div
                          key={acct.id}
                          onClick={() => onSelectAccount(acct.id)}
                          className="p-2 rounded bg-terminal-surface hover:bg-slate-800 border border-rose-900/40 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-300 hover:text-cyan-300">
                              {acct.name}
                            </span>
                            <span className="font-mono text-xs font-bold text-rose-400">
                              {formatCurrency(acct.arr, false)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-terminal-dim mt-1">
                            <span>{acct.id}</span>
                            <HealthBadge status={acct.health?.derived} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
