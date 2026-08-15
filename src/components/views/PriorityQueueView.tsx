import { useState } from 'react';
import {
  Eye,
  ArrowRight,
  Flame,
  Zap,
} from 'lucide-react';
import { ActionItem, Account, ActionBucket } from '../../types/portfolio';
import { EvidenceButton } from '../common/EvidenceButton';
import { formatCurrency } from '../../utils/formatters';

interface PriorityQueueViewProps {
  actions: ActionItem[];
  accounts: Account[];
  onSelectAccount: (accountId: string) => void;
}

export function PriorityQueueView({
  actions,
  accounts,
  onSelectAccount,
}: PriorityQueueViewProps) {
  const [selectedBucket, setSelectedBucket] = useState<string>('all');

  const accountMap = new Map<string, Account>();
  for (const acct of accounts) {
    accountMap.set(acct.id, acct);
  }

  // Sort actions by urgency descending
  const sortedActions = [...actions].sort((a, b) => (b.urgency || 0) - (a.urgency || 0));

  const nowActions = sortedActions.filter(a => a.bucket === 'now');
  const thisWeekActions = sortedActions.filter(a => a.bucket === 'this_week');
  const watchActions = sortedActions.filter(a => a.bucket === 'watch');

  const getBucketStyle = (bucket: ActionBucket) => {
    switch (bucket) {
      case 'now':
        return {
          title: 'Now (Immediate Attention)',
          icon: Flame,
          badgeBg: 'bg-rose-950 text-rose-300 border-rose-800',
          cardBorder: 'border-rose-900/60 hover:border-rose-700/80',
          urgencyColor: 'text-rose-400',
          urgencyBar: 'bg-rose-500',
          headerBg: 'bg-rose-950/40 border-rose-900/80',
        };
      case 'this_week':
        return {
          title: 'This Week (Scheduled Execution)',
          icon: Zap,
          badgeBg: 'bg-amber-950 text-amber-300 border-amber-800',
          cardBorder: 'border-amber-900/60 hover:border-amber-700/80',
          urgencyColor: 'text-amber-400',
          urgencyBar: 'bg-amber-500',
          headerBg: 'bg-amber-950/40 border-amber-900/80',
        };
      case 'watch':
        return {
          title: 'Watch (Monitoring & Timing Window)',
          icon: Eye,
          badgeBg: 'bg-slate-900 text-slate-300 border-slate-700',
          cardBorder: 'border-slate-800 hover:border-slate-700',
          urgencyColor: 'text-cyan-400',
          urgencyBar: 'bg-cyan-500',
          headerBg: 'bg-slate-900/60 border-slate-800',
        };
    }
  };

  const renderActionCard = (action: ActionItem) => {
    const account = accountMap.get(action.account_id);
    const bucketStyle = getBucketStyle(action.bucket);

    return (
      <div
        key={action.id}
        className={`bg-terminal-surface border rounded p-4 space-y-3 transition-all shadow-md ${bucketStyle.cardBorder}`}
      >
        {/* Card Header: Urgency Score Meter + Account Pill + Action ID */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Urgency Score Box */}
            <div className="p-2 rounded bg-terminal-panel border border-terminal-border text-center min-w-[58px]">
              <span className="text-[9px] font-mono uppercase text-terminal-dim block">Urgency</span>
              <span className={`text-base font-mono font-bold tabular-nums ${bucketStyle.urgencyColor}`}>
                {action.urgency}
              </span>
            </div>

            <div>
              <button
                type="button"
                onClick={() => onSelectAccount(action.account_id)}
                className="text-sm font-bold text-slate-100 hover:text-cyan-400 transition-colors flex items-center gap-1.5 text-left"
              >
                <span>{account ? account.name : action.account_id}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              </button>

              <div className="flex items-center gap-2 mt-0.5 text-[11px] font-mono text-terminal-dim">
                <span>{action.account_id}</span>
                {account && (
                  <>
                    <span>•</span>
                    <span className="text-slate-300 font-semibold">{formatCurrency(account.arr, false)} ARR</span>
                    <span>•</span>
                    <span className="capitalize">{account.stage.replace(/_/g, ' ')}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Evidence Button */}
          <EvidenceButton
            title={`Evidence for Action: ${action.action}`}
            subtitle={action.why}
            docIds={action.evidence}
          />
        </div>

        {/* Action Directive (In bold plain language) */}
        <div className="p-2.5 rounded bg-terminal-panel border border-terminal-border">
          <div className="text-[10px] font-mono uppercase text-terminal-dim font-semibold mb-1">
            Recommended Action:
          </div>
          <p className="text-xs font-semibold text-slate-100 leading-snug">
            {action.action}
          </p>
        </div>

        {/* Why Narrative */}
        <div className="space-y-1 text-xs">
          <span className="text-[10px] font-mono uppercase text-terminal-dim font-semibold">
            Context & Why:
          </span>
          <p className="text-xs text-terminal-muted leading-relaxed font-sans">
            {action.why}
          </p>
        </div>

        {/* Reason Codes */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-terminal-border/60">
          <span className="text-[10px] font-mono text-terminal-dim uppercase mr-1">Signals:</span>
          {action.reason_codes.map(code => (
            <span
              key={code}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-terminal-panel text-slate-300 border border-slate-800 font-medium"
            >
              #{code.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const sections: { bucket: ActionBucket; list: ActionItem[] }[] = [
    { bucket: 'now', list: nowActions },
    { bucket: 'this_week', list: thisWeekActions },
    { bucket: 'watch', list: watchActions },
  ];

  return (
    <div className="space-y-4 font-sans">
      {/* Top Banner */}
      <div className="bg-terminal-surface border border-terminal-border p-3.5 rounded flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div>
          <h1 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-400" />
            Ranked Execution Priority Queue
          </h1>
          <p className="text-xs text-terminal-muted mt-0.5">
            Ranked action directives deterministically generated from pipeline signals and risk thresholds.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-terminal-dim">Filter:</span>
          <button
            onClick={() => setSelectedBucket('all')}
            className={`px-2 py-1 rounded border text-[11px] ${
              selectedBucket === 'all'
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-bold'
                : 'bg-terminal-panel text-slate-300 border-terminal-border'
            }`}
          >
            All ({actions.length})
          </button>
          <button
            onClick={() => setSelectedBucket('now')}
            className={`px-2 py-1 rounded border text-[11px] ${
              selectedBucket === 'now'
                ? 'bg-rose-950 text-rose-300 border-rose-800 font-bold'
                : 'bg-terminal-panel text-slate-300 border-terminal-border'
            }`}
          >
            Now ({nowActions.length})
          </button>
          <button
            onClick={() => setSelectedBucket('this_week')}
            className={`px-2 py-1 rounded border text-[11px] ${
              selectedBucket === 'this_week'
                ? 'bg-amber-950 text-amber-300 border-amber-800 font-bold'
                : 'bg-terminal-panel text-slate-300 border-terminal-border'
            }`}
          >
            This Week ({thisWeekActions.length})
          </button>
          <button
            onClick={() => setSelectedBucket('watch')}
            className={`px-2 py-1 rounded border text-[11px] ${
              selectedBucket === 'watch'
                ? 'bg-slate-800 text-slate-200 border-slate-700 font-bold'
                : 'bg-terminal-panel text-slate-300 border-terminal-border'
            }`}
          >
            Watch ({watchActions.length})
          </button>
        </div>
      </div>

      {/* 3 Grouped Sections: Now, This Week, Watch */}
      <div className="space-y-6">
        {sections.map(({ bucket, list }) => {
          if (selectedBucket !== 'all' && selectedBucket !== bucket) return null;
          const style = getBucketStyle(bucket);
          const Icon = style.icon;

          return (
            <div key={bucket} className="space-y-3">
              {/* Group Header */}
              <div className={`p-2.5 rounded border flex items-center justify-between ${style.headerBg}`}>
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-slate-200" />
                  <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100">
                    {style.title}
                  </h2>
                </div>
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border font-bold ${style.badgeBg}`}>
                  {list.length} {list.length === 1 ? 'Action' : 'Actions'}
                </span>
              </div>

              {list.length === 0 ? (
                <div className="p-6 bg-terminal-surface border border-dashed border-terminal-border rounded text-center text-xs font-mono text-terminal-dim">
                  No queued actions in this bucket.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map(action => renderActionCard(action))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
