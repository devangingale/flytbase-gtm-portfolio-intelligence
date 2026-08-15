import { useState } from 'react';
import {
  Activity,
  AlertOctagon,
  FilePlus,
  TrendingDown,
  RefreshCw,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { ChangeFeedEntry, Account, SourceDocument } from '../../types/portfolio';
import { formatTimestamp, formatChangeType } from '../../utils/formatters';
import { EvidenceButton } from '../common/EvidenceButton';

interface ChangeFeedViewProps {
  changeFeed: ChangeFeedEntry[];
  accounts: Account[];
  documents?: SourceDocument[];
  onSelectAccount: (accountId: string) => void;
}

export function ChangeFeedView({
  changeFeed,
  accounts,
  onSelectAccount,
}: ChangeFeedViewProps) {
  const [filterType, setFilterType] = useState<string>('all');

  const accountMap = new Map<string, Account>();
  for (const acct of accounts) {
    accountMap.set(acct.id, acct);
  }

  // Types list for filtering
  const uniqueTypes = Array.from(new Set(changeFeed.map(c => c.type)));

  const filteredFeed = changeFeed.filter(entry => {
    if (filterType !== 'all' && entry.type !== filterType) return false;
    return true;
  });

  const getEntryBadge = (type: string) => {
    switch (type) {
      case 'document_withdrawn':
      case 'claim_invalidated':
        return {
          icon: AlertOctagon,
          bg: 'bg-rose-950/80 text-rose-300 border-rose-800',
          border: 'border-rose-900/80 hover:border-rose-700',
          dot: 'bg-rose-500',
        };
      case 'usage_updated':
        return {
          icon: TrendingDown,
          bg: 'bg-amber-950/80 text-amber-300 border-amber-800',
          border: 'border-amber-900/60 hover:border-amber-700',
          dot: 'bg-amber-500',
        };
      case 'document_added':
        return {
          icon: FilePlus,
          bg: 'bg-cyan-950/80 text-cyan-300 border-cyan-800',
          border: 'border-cyan-900/60 hover:border-cyan-700',
          dot: 'bg-cyan-500',
        };
      default:
        return {
          icon: RefreshCw,
          bg: 'bg-slate-900 text-slate-300 border-slate-700',
          border: 'border-slate-800 hover:border-slate-700',
          dot: 'bg-slate-400',
        };
    }
  };

  // Helper to extract referenced doc_IDs from description string if present
  const extractDocIds = (text: string): string[] => {
    const matches = text.match(/doc_\d+/g);
    return matches ? Array.from(new Set(matches)) : [];
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Header Banner */}
      <div className="bg-terminal-surface border border-terminal-border p-3.5 rounded flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div>
          <h1 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Autonomous System Audit Log & Change Feed
          </h1>
          <p className="text-xs text-terminal-muted mt-0.5">
            Real-time event stream of incoming documents, telemetry updates, and derived health mutations.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap font-mono text-xs">
          <span className="text-terminal-dim text-[11px] uppercase mr-1">Filter:</span>
          <button
            onClick={() => setFilterType('all')}
            className={`px-2 py-0.5 rounded text-[11px] border ${
              filterType === 'all'
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-semibold'
                : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:text-slate-200'
            }`}
          >
            All Events ({changeFeed.length})
          </button>
          {uniqueTypes.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2 py-0.5 rounded text-[11px] border ${
                filterType === t
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-semibold'
                  : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:text-slate-200'
              }`}
            >
              {formatChangeType(t)}
            </button>
          ))}
        </div>
      </div>

      {/* Feed List */}
      <div className="space-y-3">
        {filteredFeed.length === 0 ? (
          <div className="p-8 bg-terminal-surface border border-dashed border-terminal-border rounded text-center text-xs font-mono text-terminal-dim">
            No change feed events found.
          </div>
        ) : (
          filteredFeed.map((entry) => {
            const account = accountMap.get(entry.account_id);
            const style = getEntryBadge(entry.type);
            const Icon = style.icon;
            const isRetraction = entry.type === 'document_withdrawn' || entry.type === 'claim_invalidated';
            const docIds = extractDocIds(entry.description);

            return (
              <div
                key={entry.id}
                className={`bg-terminal-surface border rounded p-4 space-y-2.5 transition-all shadow-md ${style.border} ${
                  isRetraction ? 'bg-rose-950/10' : ''
                }`}
              >
                {/* Top Row: Timestamp + Event Type Badge + Account */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-terminal-border/50 pb-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded border ${style.bg}`}>
                      <Icon className="w-3 h-3" />
                      {formatChangeType(entry.type)}
                    </span>

                    {entry.account_id && (
                      <button
                        onClick={() => onSelectAccount(entry.account_id)}
                        className="text-xs font-bold text-slate-200 hover:text-cyan-400 font-sans flex items-center gap-1 transition-colors"
                      >
                        <span>{account ? account.name : entry.account_id}</span>
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] font-mono text-terminal-dim">
                    {docIds.length > 0 && (
                      <EvidenceButton
                        title={`Event Evidence: ${entry.description}`}
                        subtitle={entry.consequence}
                        docIds={docIds}
                        hasRetractedDoc={isRetraction}
                        variant="inline"
                      />
                    )}
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{formatTimestamp(entry.at)}</span>
                      <span className="text-slate-600">({entry.id})</span>
                    </div>
                  </div>
                </div>

                {/* What Changed (Description) */}
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase text-terminal-dim font-semibold">
                    Change Event:
                  </span>
                  <p className={`text-xs leading-relaxed font-sans ${isRetraction ? 'text-rose-200 font-medium' : 'text-slate-200'}`}>
                    {entry.description}
                  </p>
                </div>

                {/* What the System Concluded Differently (Consequence) */}
                <div className={`p-2.5 rounded text-xs space-y-1 font-sans ${
                  isRetraction
                    ? 'bg-rose-950/40 border border-rose-800/80 text-rose-100'
                    : 'bg-terminal-panel border border-terminal-border text-slate-300'
                }`}>
                  <div className="flex items-center gap-1 text-[10px] font-mono uppercase font-bold text-cyan-400">
                    <Activity className="w-3 h-3 text-cyan-400" />
                    <span>System Consequence & Deduction:</span>
                  </div>
                  <p className="leading-relaxed font-medium">
                    {entry.consequence}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
