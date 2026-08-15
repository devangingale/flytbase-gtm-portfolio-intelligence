import { useState, useMemo } from 'react';
import {
  ArrowUpDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Account, ActionItem } from '../../types/portfolio';
import { HealthBadge, StageBadge } from '../common/Badge';
import { Sparkline } from '../common/Sparkline';
import { MismatchIndicator } from '../common/MismatchIndicator';
import { formatCurrency, formatStage } from '../../utils/formatters';

interface PortfolioViewProps {
  accounts: Account[];
  actions: ActionItem[];
  flashingAccountIds: Set<string>;
  onSelectAccount: (accountId: string) => void;
}

type SortField = 'arr' | 'health' | 'risks' | 'name';
type SortDirection = 'asc' | 'desc';

export function PortfolioView({
  accounts,
  actions,
  flashingAccountIds,
  onSelectAccount,
}: PortfolioViewProps) {
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('arr');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Map actions by account id for quick lookup
  const actionByAccount = useMemo(() => {
    const map = new Map<string, ActionItem>();
    for (const act of actions) {
      if (!map.has(act.account_id)) {
        map.set(act.account_id, act);
      }
    }
    return map;
  }, [actions]);

  // Lifecycle stages for filter chips
  const stages = useMemo(() => {
    const unique = Array.from(new Set(accounts.map(a => a.stage))).filter(Boolean);
    return ['all', ...unique];
  }, [accounts]);

  // Health priority helper for sorting
  const getHealthWeight = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'critical':
      case 'lost':
        return 4;
      case 'at_risk':
        return 3;
      case 'warm':
        return 2;
      case 'healthy':
      case 'secure':
        return 1;
      default:
        return 0;
    }
  };

  // Filter and sort accounts
  const filteredAndSortedAccounts = useMemo(() => {
    let result = accounts.filter(account => {
      if (selectedStage !== 'all' && account.stage !== selectedStage) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = account.name.toLowerCase().includes(q);
        const matchesId = account.id.toLowerCase().includes(q);
        if (!matchesName && !matchesId) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'arr') {
        comparison = (a.arr || 0) - (b.arr || 0);
      } else if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'health') {
        comparison = getHealthWeight(a.health?.derived) - getHealthWeight(b.health?.derived);
      } else if (sortField === 'risks') {
        comparison = (a.risks?.length || 0) - (b.risks?.length || 0);
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [accounts, selectedStage, sortField, sortDirection, searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Top Controls: Filter Chips, Search, and Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-terminal-surface p-2.5 rounded border border-terminal-border">
        {/* Stage Filter Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-mono text-terminal-dim uppercase mr-1">Stage:</span>
          {stages.map(stage => (
            <button
              key={stage}
              onClick={() => setSelectedStage(stage)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all border ${
                selectedStage === stage
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-semibold'
                  : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:text-slate-200'
              }`}
            >
              {stage === 'all' ? 'All Accounts' : formatStage(stage)}
              <span className="ml-1 text-[10px] opacity-70">
                ({stage === 'all' ? accounts.length : accounts.filter(a => a.stage === stage).length})
              </span>
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter accounts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1 bg-terminal-bg border border-terminal-border rounded text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-600 font-mono w-48"
          />
        </div>
      </div>

      {/* Main High-Density Table */}
      <div className="bg-terminal-surface border border-terminal-border rounded overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-terminal-panel border-b border-terminal-border text-[11px] font-mono text-terminal-dim uppercase tracking-wider select-none">
                <th className="py-2.5 px-3 font-semibold">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center gap-1 hover:text-slate-200"
                  >
                    <span>Account</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  </button>
                </th>
                <th className="py-2.5 px-2.5 font-semibold">Stage</th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  <button
                    onClick={() => handleSort('arr')}
                    className="flex items-center gap-1 ml-auto hover:text-slate-200"
                  >
                    <span>ARR</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  </button>
                </th>
                <th className="py-2.5 px-2.5 font-semibold">
                  <button
                    onClick={() => handleSort('health')}
                    className="flex items-center gap-1 hover:text-slate-200"
                  >
                    <span>Health (Derived)</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  </button>
                </th>
                <th className="py-2.5 px-2.5 font-semibold">Health (CRM)</th>
                <th className="py-2.5 px-3 font-semibold">Usage Sparkline</th>
                <th className="py-2.5 px-2.5 font-semibold text-center">
                  <button
                    onClick={() => handleSort('risks')}
                    className="flex items-center gap-1 justify-center mx-auto hover:text-slate-200"
                  >
                    <span>Risks</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-semibold">Next Action Summary</th>
                <th className="py-2.5 px-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/60 font-sans">
              {filteredAndSortedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-terminal-muted font-mono text-xs">
                    No accounts matching current filter criteria.
                  </td>
                </tr>
              ) : (
                filteredAndSortedAccounts.map((account) => {
                  const isFlashing = flashingAccountIds.has(account.id);
                  const nextAction = actionByAccount.get(account.id);
                  const hasMismatch = account.health?.mismatch;
                  const openRisksCount = account.risks?.length || 0;

                  return (
                    <tr
                      key={account.id}
                      onClick={() => onSelectAccount(account.id)}
                      className={`group cursor-pointer transition-colors hover:bg-terminal-hover ${
                        isFlashing
                          ? 'animate-highlight-flash bg-blue-950/40'
                          : 'bg-terminal-surface'
                      }`}
                    >
                      {/* Account Name & ID */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors">
                              {account.name}
                            </div>
                            <div className="text-[10px] font-mono text-terminal-dim">
                              {account.id}
                            </div>
                          </div>
                          {hasMismatch && (
                            <MismatchIndicator health={account.health} compact />
                          )}
                        </div>
                      </td>

                      {/* Stage */}
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <StageBadge stage={account.stage} />
                      </td>

                      {/* ARR */}
                      <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-slate-100 whitespace-nowrap">
                        {formatCurrency(account.arr, false)}
                      </td>

                      {/* Derived Health */}
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <HealthBadge status={account.health?.derived} />
                      </td>

                      {/* CRM Health */}
                      <td className="py-2.5 px-2.5 whitespace-nowrap font-mono text-[11px] text-terminal-muted">
                        <span className="capitalize">{account.health?.crm_label || 'none'}</span>
                      </td>

                      {/* Usage Sparkline */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <Sparkline usage={account.usage} showDetails />
                      </td>

                      {/* Open Risk Count */}
                      <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                        {openRisksCount > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-800/80">
                            {openRisksCount}
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-terminal-dim">0</span>
                        )}
                      </td>

                      {/* Next Action Summary */}
                      <td className="py-2.5 px-3 max-w-xs">
                        {nextAction ? (
                          <div className="space-y-0.5">
                            <p className="text-xs text-slate-200 font-medium line-clamp-1 group-hover:text-slate-100">
                              {nextAction.action}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[9px] font-mono uppercase px-1 py-0.2 rounded font-semibold ${
                                  nextAction.bucket === 'now'
                                    ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                    : nextAction.bucket === 'this_week'
                                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                                }`}
                              >
                                {nextAction.bucket.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] font-mono text-terminal-dim truncate">
                                {nextAction.reason_codes.slice(0, 2).join(', ')}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-terminal-dim italic">
                            No queued action
                          </span>
                        )}
                      </td>

                      {/* Chevron Arrow */}
                      <td className="py-2.5 px-2 text-right text-terminal-dim group-hover:text-cyan-400">
                        <ChevronRight className="w-4 h-4 ml-auto" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Bottom Status Bar */}
        <div className="p-2.5 bg-terminal-panel/80 border-t border-terminal-border flex items-center justify-between text-[11px] font-mono text-terminal-dim">
          <span>Displaying {filteredAndSortedAccounts.length} of {accounts.length} portfolio accounts</span>
          <span className="text-cyan-400">Click any row to inspect account deep-dive</span>
        </div>
      </div>
    </div>
  );
}
