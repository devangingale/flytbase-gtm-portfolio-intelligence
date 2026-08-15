import { ConfidenceLevel, SeverityLevel, LifecycleStage, HealthStatus } from '../../types/portfolio';
import { formatStage } from '../../utils/formatters';

interface HealthBadgeProps {
  status: HealthStatus | string;
  size?: 'sm' | 'md';
}

export function HealthBadge({ status, size = 'sm' }: HealthBadgeProps) {
  const norm = status?.toLowerCase() || '';
  let colorStyles = 'bg-slate-800/80 text-slate-300 border-slate-700';
  let dotColor = 'bg-slate-400';

  if (norm === 'healthy' || norm === 'secure') {
    colorStyles = 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60';
    dotColor = 'bg-emerald-400';
  } else if (norm === 'at_risk' || norm === 'risk') {
    colorStyles = 'bg-amber-950/70 text-amber-300 border-amber-800/60';
    dotColor = 'bg-amber-400';
  } else if (norm === 'critical' || norm === 'lost') {
    colorStyles = 'bg-rose-950/70 text-rose-300 border-rose-800/60';
    dotColor = 'bg-rose-400';
  } else if (norm === 'warm' || norm === 'evaluating') {
    colorStyles = 'bg-sky-950/70 text-sky-300 border-sky-800/60';
    dotColor = 'bg-sky-400';
  } else if (norm === 'churned') {
    colorStyles = 'bg-zinc-900 text-zinc-400 border-zinc-700';
    dotColor = 'bg-zinc-500';
  }

  const label = norm.replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium uppercase tracking-wider rounded border font-mono ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      } ${colorStyles}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

interface SeverityBadgeProps {
  severity: SeverityLevel;
  size?: 'sm' | 'md';
}

export function SeverityBadge({ severity, size = 'sm' }: SeverityBadgeProps) {
  const norm = severity?.toLowerCase();
  let color = 'bg-slate-800 text-slate-300 border-slate-700';

  if (norm === 'high') {
    color = 'bg-rose-950/80 text-rose-300 border-rose-800/70';
  } else if (norm === 'medium') {
    color = 'bg-amber-950/80 text-amber-300 border-amber-800/70';
  } else if (norm === 'low') {
    color = 'bg-emerald-950/80 text-emerald-300 border-emerald-800/70';
  }

  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded border font-mono ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      } ${color}`}
    >
      {severity}
    </span>
  );
}

interface StageBadgeProps {
  stage: LifecycleStage;
}

export function StageBadge({ stage }: StageBadgeProps) {
  const norm = stage?.toLowerCase() || '';
  let color = 'bg-slate-800/60 text-slate-300 border-slate-700/60';

  if (norm === 'active_customer') {
    color = 'bg-blue-950/50 text-blue-300 border-blue-800/50';
  } else if (norm === 'prospect') {
    color = 'bg-purple-950/50 text-purple-300 border-purple-800/50';
  } else if (norm === 'churned') {
    color = 'bg-zinc-900/80 text-zinc-400 border-zinc-700/70';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${color}`}>
      {formatStage(stage)}
    </span>
  );
}

interface ConfidenceIndicatorProps {
  confidence: ConfidenceLevel;
}

/**
 * 3-state indicator for confidence (high, medium, low) - not a percentage
 */
export function ConfidenceIndicator({ confidence }: ConfidenceIndicatorProps) {
  const norm = confidence?.toLowerCase() || 'medium';

  let dotColor = 'bg-emerald-400';
  let textColor = 'text-emerald-400';

  if (norm === 'low') {
    dotColor = 'bg-rose-400';
    textColor = 'text-rose-400';
  } else if (norm === 'medium') {
    dotColor = 'bg-amber-400';
    textColor = 'text-amber-400';
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono" title={`Confidence: ${confidence}`}>
      <span className="flex gap-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${norm === 'high' || norm === 'medium' || norm === 'low' ? dotColor : 'bg-slate-600'}`} />
        <span className={`w-1.5 h-1.5 rounded-full ${norm === 'high' || norm === 'medium' ? dotColor : 'bg-slate-700'}`} />
        <span className={`w-1.5 h-1.5 rounded-full ${norm === 'high' ? dotColor : 'bg-slate-700'}`} />
      </span>
      <span className={`${textColor} uppercase tracking-wider text-[9px] font-semibold`}>
        {norm}
      </span>
    </span>
  );
}
