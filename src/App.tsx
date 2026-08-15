import { useState, useEffect } from 'react';
import { usePortfolio } from './hooks/usePortfolio';
import { EvidenceProvider } from './context/EvidenceContext';
import { Shell } from './components/layout/Shell';
import { ViewType } from './components/layout/Sidebar';
import { EvidenceDrawer } from './components/common/EvidenceDrawer';

// 7 Views
import { PortfolioView } from './components/views/PortfolioView';
import { AccountDetailView } from './components/views/AccountDetailView';
import { PriorityQueueView } from './components/views/PriorityQueueView';
import { RenewalRevenueView } from './components/views/RenewalRevenueView';
import { ExpansionView } from './components/views/ExpansionView';
import { SignalVsLabelView } from './components/views/SignalVsLabelView';
import { ChangeFeedView } from './components/views/ChangeFeedView';

import { Loader2, Radio, RefreshCw, Server } from 'lucide-react';

export function AppContent() {
  const {
    data,
    loading,
    error,
    secondsSinceSync,
    isPolling,
    flashingAccountIds,
    refetch,
    apiUrl,
  } = usePortfolio();

  const [currentView, setCurrentView] = useState<ViewType>('portfolio');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Default to first account if none selected
  useEffect(() => {
    if (data && data.accounts && data.accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(data.accounts[0].id);
    }
  }, [data, selectedAccountId]);

  // Keyboard navigation shortcuts (1-7)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      switch (e.key) {
        case '1':
          setCurrentView('portfolio');
          break;
        case '2':
          setCurrentView('account_detail');
          break;
        case '3':
          setCurrentView('priority_queue');
          break;
        case '4':
          setCurrentView('renewal_revenue');
          break;
        case '5':
          setCurrentView('expansion');
          break;
        case '6':
          setCurrentView('signal_vs_label');
          break;
        case '7':
          setCurrentView('change_feed');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    setCurrentView('account_detail');
  };

  const selectedAccount = data && data.accounts
    ? data.accounts.find(a => a.id === selectedAccountId) || data.accounts[0] || null
    : null;

  if (loading && !data && !error) {
    return (
      <div className="h-screen w-screen bg-terminal-bg flex flex-col items-center justify-center text-slate-300 font-mono space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        <div className="text-xs uppercase tracking-widest text-slate-400">
          Connecting to Live Backend Telemetry ({apiUrl})...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-screen w-screen bg-terminal-bg flex flex-col items-center justify-center p-6 text-center font-mono space-y-5">
        <div className="p-4 rounded-full bg-terminal-panel border border-terminal-border text-cyan-400 relative">
          <Server className="w-8 h-8" />
          <span className="w-3 h-3 rounded-full bg-amber-400 absolute top-1 right-1 animate-ping" />
        </div>

        <div className="space-y-2 max-w-md">
          <div className="flex items-center justify-center gap-2 text-amber-400 text-xs uppercase tracking-wider font-bold">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>Awaiting Backend Pipeline Stream</span>
          </div>
          <h1 className="text-base font-bold text-slate-100">
            Listening on <code className="text-cyan-300 bg-terminal-panel px-2 py-0.5 rounded border border-terminal-border">{apiUrl}</code>
          </h1>
          <p className="text-xs text-terminal-muted font-sans leading-relaxed">
            Frontend is ready and polling every 20 seconds. Once your backend pipeline serves the derived portfolio state, this interface will activate automatically.
          </p>
        </div>

        <div className="p-3 rounded bg-terminal-surface border border-terminal-border text-left font-mono text-[11px] text-terminal-dim max-w-md w-full space-y-1">
          <div className="flex justify-between text-slate-400">
            <span>Poll Interval:</span>
            <span className="text-emerald-400">20s auto-retry</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Last Attempt Status:</span>
            <span className="text-amber-400 truncate max-w-[200px]">{error.message}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Configuration Flag:</span>
            <span className="text-slate-300">VITE_API_BASE (optional)</span>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isPolling}
          className="flex items-center gap-2 px-4 py-2 rounded bg-terminal-panel hover:bg-slate-800 text-xs text-slate-200 border border-cyan-800/80 hover:border-cyan-600 transition-all shadow-md disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isPolling ? 'animate-spin' : ''}`} />
          <span>{isPolling ? 'Polling Backend...' : 'Check Connection Now'}</span>
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <Shell
      data={data}
      currentView={currentView}
      onNavigate={setCurrentView}
      selectedAccountId={selectedAccountId}
      secondsSinceSync={secondsSinceSync}
      isPolling={isPolling}
      onRefresh={refetch}
    >
      {currentView === 'portfolio' && (
        <PortfolioView
          accounts={data.accounts || []}
          actions={data.actions || []}
          flashingAccountIds={flashingAccountIds}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {currentView === 'account_detail' && (
        <AccountDetailView
          account={selectedAccount}
          allAccounts={data.accounts || []}
          documents={data.documents || []}
          actions={data.actions || []}
          onBack={() => setCurrentView('portfolio')}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {currentView === 'priority_queue' && (
        <PriorityQueueView
          actions={data.actions || []}
          accounts={data.accounts || []}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {currentView === 'renewal_revenue' && (
        <RenewalRevenueView
          totals={data.totals || {
            arr_total: 0,
            arr_secure: 0,
            arr_at_risk: 0,
            arr_lost: 0,
            forecast: 0,
            forecast_basis: 'Awaiting model forecast basis from backend.',
          }}
          accounts={data.accounts || []}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {currentView === 'expansion' && (
        <ExpansionView
          accounts={data.accounts || []}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {currentView === 'signal_vs_label' && (
        <SignalVsLabelView
          accounts={data.accounts || []}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {currentView === 'change_feed' && (
        <ChangeFeedView
          changeFeed={data.change_feed || []}
          accounts={data.accounts || []}
          onSelectAccount={handleSelectAccount}
        />
      )}

      {/* Global Evidence Inspector Drawer */}
      <EvidenceDrawer
        documents={data.documents || []}
        accounts={data.accounts || []}
      />
    </Shell>
  );
}

export default function App() {
  return (
    <EvidenceProvider>
      <AppContent />
    </EvidenceProvider>
  );
}
