import { RefreshCw, Radio, Database } from 'lucide-react';
import { Meta } from '../../types/portfolio';

interface HeaderProps {
  meta?: Meta;
  secondsSinceSync: number;
  isPolling: boolean;
  onRefresh: () => void;
  selectedAccountId?: string | null;
  onSelectAccount?: (id: string | null) => void;
}

export function Header({
  meta,
  secondsSinceSync,
  isPolling,
  onRefresh,
}: HeaderProps) {
  const isAmber = secondsSinceSync >= 90 && secondsSinceSync < 300;
  const isRed = secondsSinceSync >= 300;

  let heartbeatColor = 'text-emerald-400 border-emerald-800/70 bg-emerald-950/40';
  let dotColor = 'bg-emerald-400';
  let syncLabel = `Synced ${secondsSinceSync}s ago`;

  if (secondsSinceSync === 0) {
    syncLabel = 'Synced just now';
  }

  if (isRed) {
    heartbeatColor = 'text-rose-400 border-rose-800/70 bg-rose-950/50 animate-pulse';
    dotColor = 'bg-rose-400';
    syncLabel = `Sync delayed (${secondsSinceSync}s ago)`;
  } else if (isAmber) {
    heartbeatColor = 'text-amber-400 border-amber-800/70 bg-amber-950/40';
    dotColor = 'bg-amber-400';
    syncLabel = `Synced ${secondsSinceSync}s ago`;
  }

  return (
    <header className="h-12 bg-terminal-surface border-b border-terminal-border px-4 flex items-center justify-between select-none z-20">
      {/* Left: Terminal Brand & Subtitle */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-sm bg-cyan-400 animate-pulse" />
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-100">
            GTM Command Center
          </span>
        </div>
        <span className="text-terminal-dim text-xs font-mono">|</span>
        <span className="text-[11px] font-mono text-terminal-muted hidden sm:inline">
          Autonomous Fleet Intelligence
        </span>
      </div>

      {/* Right: Telemetry & Sync Heartbeat */}
      <div className="flex items-center gap-3 font-mono text-xs">
        {/* Source Doc count */}
        {meta && (
          <div className="hidden md:flex items-center gap-1.5 text-terminal-dim text-[11px]">
            <Database className="w-3.5 h-3.5 text-slate-500" />
            <span>{meta.source_doc_count} source docs</span>
          </div>
        )}

        {/* Sync Heartbeat (Core PRD Behavior) */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1 rounded border text-[11px] transition-colors ${heartbeatColor}`}
          title={`Backend polling cycle: 20s. Last sync: ${meta?.last_sync_at || 'unknown'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${isPolling ? 'animate-ping' : ''}`} />
          <span className="font-medium">{syncLabel}</span>
          <Radio className={`w-3 h-3 ${isPolling ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
        </div>

        {/* Manual Refresh Trigger */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isPolling}
          className="p-1.5 rounded border border-terminal-border bg-terminal-panel hover:bg-slate-800 text-slate-300 hover:text-white transition-all disabled:opacity-50"
          title="Trigger immediate sync check"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin text-cyan-400' : ''}`} />
        </button>
      </div>
    </header>
  );
}
