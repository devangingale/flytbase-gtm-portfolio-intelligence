import { ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar, ViewType } from './Sidebar';
import { PortfolioData } from '../../types/portfolio';

interface ShellProps {
  children: ReactNode;
  data: PortfolioData | null;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  selectedAccountId: string | null;
  secondsSinceSync: number;
  isPolling: boolean;
  onRefresh: () => void;
}

export function Shell({
  children,
  data,
  currentView,
  onNavigate,
  selectedAccountId,
  secondsSinceSync,
  isPolling,
  onRefresh,
}: ShellProps) {
  return (
    <div className="h-screen w-screen bg-terminal-bg text-terminal-text flex flex-col overflow-hidden select-text">
      {/* Persistent Terminal Header with Sync Heartbeat */}
      <Header
        meta={data?.meta}
        secondsSinceSync={secondsSinceSync}
        isPolling={isPolling}
        onRefresh={onRefresh}
      />

      {/* Main Body: Fixed Sidebar + Scrollable Content */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          currentView={currentView}
          onNavigate={onNavigate}
          data={data}
          selectedAccountId={selectedAccountId}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-terminal-bg">
          <div className="max-w-7xl mx-auto space-y-4">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
