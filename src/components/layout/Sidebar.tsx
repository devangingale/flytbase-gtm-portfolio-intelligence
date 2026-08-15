import {
  LayoutGrid,
  Building2,
  ListTodo,
  TrendingUp,
  ArrowUpRight,
  GitCompare,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { PortfolioData } from '../../types/portfolio';

export type ViewType =
  | 'portfolio'
  | 'account_detail'
  | 'priority_queue'
  | 'renewal_revenue'
  | 'expansion'
  | 'signal_vs_label'
  | 'change_feed';

interface SidebarProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  data: PortfolioData | null;
  selectedAccountId: string | null;
}

export function Sidebar({ currentView, onNavigate, data, selectedAccountId }: SidebarProps) {
  const actionsCount = data?.actions?.length || 0;
  const mismatchCount = data?.accounts?.filter(a => a.health?.mismatch)?.length || 0;
  const changeCount = data?.change_feed?.length || 0;
  const accountsCount = data?.accounts?.length || 0;

  const selectedAccountName = selectedAccountId && data
    ? data.accounts.find(a => a.id === selectedAccountId)?.name
    : null;

  const navItems = [
    {
      id: 'portfolio' as ViewType,
      label: 'Portfolio',
      icon: LayoutGrid,
      badge: `${accountsCount}`,
      shortcut: '1',
    },
    {
      id: 'account_detail' as ViewType,
      label: 'Account Detail',
      icon: Building2,
      sublabel: selectedAccountName || 'Select an account',
      badge: selectedAccountId ? 'active' : undefined,
      shortcut: '2',
    },
    {
      id: 'priority_queue' as ViewType,
      label: 'Priority Queue',
      icon: ListTodo,
      badge: actionsCount > 0 ? `${actionsCount}` : undefined,
      badgeColor: 'bg-rose-950 text-rose-400 border-rose-800',
      shortcut: '3',
    },
    {
      id: 'renewal_revenue' as ViewType,
      label: 'Renewal & Revenue',
      icon: TrendingUp,
      shortcut: '4',
    },
    {
      id: 'expansion' as ViewType,
      label: 'Expansion',
      icon: ArrowUpRight,
      shortcut: '5',
    },
    {
      id: 'signal_vs_label' as ViewType,
      label: 'Signal vs Label',
      icon: GitCompare,
      badge: mismatchCount > 0 ? `${mismatchCount} mismatch` : undefined,
      badgeColor: 'bg-amber-950 text-amber-300 border-amber-800',
      shortcut: '6',
    },
    {
      id: 'change_feed' as ViewType,
      label: 'Change Feed',
      icon: Activity,
      badge: changeCount > 0 ? `${changeCount}` : undefined,
      badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-800',
      shortcut: '7',
    },
  ];

  return (
    <aside className="w-60 bg-terminal-surface border-r border-terminal-border flex flex-col justify-between select-none z-10 shrink-0">
      {/* Navigation list */}
      <div className="p-2 space-y-1">
        <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-terminal-dim font-semibold">
          Views & Workflows
        </div>

        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-mono transition-all text-left group ${
                isActive
                  ? 'bg-terminal-panel text-white border border-cyan-800/80 shadow-sm font-semibold'
                  : 'text-terminal-muted hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
                  }`}
                />
                <div className="truncate">
                  <div className="truncate">{item.label}</div>
                  {item.sublabel && (
                    <div className="text-[10px] text-terminal-dim font-sans truncate">
                      {item.sublabel}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                      item.badgeColor || (isActive ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-900 text-slate-400 border-slate-800')
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
                {isActive && <ChevronRight className="w-3 h-3 text-cyan-400" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer info strip */}
      <div className="p-3 border-t border-terminal-border bg-terminal-panel/30 text-[10px] font-mono text-terminal-dim space-y-1">
        <div className="flex items-center justify-between">
          <span>Data Source</span>
          <span className="text-cyan-400 font-semibold">GET /api/portfolio</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Poll Cycle</span>
          <span className="text-emerald-400 font-semibold">20s auto</span>
        </div>
      </div>
    </aside>
  );
}
