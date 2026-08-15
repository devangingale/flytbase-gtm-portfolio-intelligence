import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';
import { Usage } from '../../types/portfolio';

interface SparklineProps {
  usage: Usage | null | undefined;
  width?: number | string;
  height?: number;
  showDetails?: boolean;
}

export function Sparkline({ usage, height = 24, showDetails = false }: SparklineProps) {
  if (!usage || !usage.series || usage.series.length === 0) {
    return (
      <span className="text-[11px] font-mono text-terminal-dim italic">
        No flight data
      </span>
    );
  }

  const data = usage.series.map(point => ({
    month: point.month,
    hours: point.flight_hours,
    missions: point.missions,
  }));

  const isDeclining = usage.pct_change < 0;
  const isGrowing = usage.pct_change > 0;
  const strokeColor = isDeclining ? '#EF4444' : isGrowing ? '#10B981' : '#94A3B8';

  return (
    <div className="flex items-center gap-2">
      <div className="w-20" style={{ height: `${height}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="hours"
              stroke={strokeColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            {showDetails && (
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const d = payload[0].payload;
                    return (
                      <div className="bg-terminal-panel border border-terminal-border p-1.5 rounded text-[10px] font-mono shadow-lg">
                        <p className="text-slate-400">{d.month}</p>
                        <p className="text-white font-bold">{d.hours} hrs ({d.missions} missions)</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <span
        className={`text-[11px] font-mono font-medium ${
          isDeclining ? 'text-rose-400' : isGrowing ? 'text-emerald-400' : 'text-slate-400'
        }`}
      >
        {usage.pct_change > 0 ? '+' : ''}
        {usage.pct_change.toFixed(1)}%
      </span>
    </div>
  );
}
