import { AlertTriangle } from 'lucide-react';
import { AccountHealth } from '../../types/portfolio';

interface MismatchIndicatorProps {
  health: AccountHealth;
  compact?: boolean;
}

export function MismatchIndicator({ health, compact = false }: MismatchIndicatorProps) {
  if (!health.mismatch) {
    return null;
  }

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-700/80 cursor-help"
        title={health.mismatch_reason || 'Derived health disagrees with CRM label'}
      >
        <AlertTriangle className="w-3 h-3 text-amber-400" />
        MISMATCH
      </span>
    );
  }

  return (
    <div className="p-2 rounded bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs font-sans flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold uppercase text-[10px] tracking-wider text-amber-400">
            Health Disagreement Signal
          </span>
          <span className="text-[11px] text-amber-300/80 font-mono">
            CRM: {health.crm_label} | Derived: {health.derived}
          </span>
        </div>
        <p className="text-xs text-amber-200/90 leading-snug">
          {health.mismatch_reason || 'Derived usage signals conflict with the recorded CRM status.'}
        </p>
      </div>
    </div>
  );
}
