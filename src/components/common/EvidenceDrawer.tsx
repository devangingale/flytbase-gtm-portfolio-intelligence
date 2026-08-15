import { useEffect } from 'react';
import { X, Calendar, AlertOctagon, ShieldAlert } from 'lucide-react';
import { useEvidence } from '../../context/EvidenceContext';
import { SourceDocument, Account } from '../../types/portfolio';
import { ConfidenceIndicator } from './Badge';
import { formatDate, formatDocType } from '../../utils/formatters';
import { resolveDocuments, getInvalidatedClaimsCount } from '../../utils/evidence';

interface EvidenceDrawerProps {
  documents: SourceDocument[];
  accounts: Account[];
}

export function EvidenceDrawer({ documents, accounts }: EvidenceDrawerProps) {
  const { target, isOpen, closeEvidence } = useEvidence();

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeEvidence();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeEvidence]);

  if (!isOpen || !target) return null;

  const resolvedDocs = resolveDocuments(target.docIds, documents);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Dark backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity"
        onClick={closeEvidence}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-lg bg-terminal-surface border-l border-terminal-border flex flex-col shadow-2xl">
          {/* Header */}
          <div className="p-4 border-b border-terminal-border bg-terminal-panel flex items-start justify-between">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 font-semibold px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60">
                  Source Evidence Trace
                </span>
                {target.confidence && (
                  <ConfidenceIndicator confidence={target.confidence} />
                )}
              </div>
              <h2 className="text-sm font-semibold text-terminal-text leading-snug">
                {target.title}
              </h2>
              {target.subtitle && (
                <p className="text-xs text-terminal-muted leading-relaxed font-sans">
                  {target.subtitle}
                </p>
              )}
            </div>

            <button
              onClick={closeEvidence}
              className="p-1 rounded text-terminal-muted hover:text-white hover:bg-slate-800 transition-colors"
              title="Close evidence drawer (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans">
            <div className="flex items-center justify-between text-xs text-terminal-dim font-mono">
              <span>Supporting documents ({resolvedDocs.length})</span>
              <span>All claims evidence-linked</span>
            </div>

            {resolvedDocs.length === 0 ? (
              <div className="p-6 rounded border border-dashed border-terminal-border text-center text-terminal-muted text-xs font-mono">
                No matching source document found for IDs: {target.docIds.join(', ')}
              </div>
            ) : (
              resolvedDocs.map((doc) => {
                const isWithdrawn = doc.status === 'withdrawn';
                const invalidatedCount = isWithdrawn ? getInvalidatedClaimsCount(doc.id, accounts) : 0;

                return (
                  <div
                    key={doc.id}
                    className={`rounded border transition-all p-3.5 space-y-2.5 ${
                      isWithdrawn
                        ? 'bg-rose-950/20 border-rose-800/60 relative overflow-hidden'
                        : 'bg-terminal-panel/90 border-terminal-border'
                    }`}
                  >
                    {/* Top Bar of Card */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-mono font-semibold text-terminal-dim">
                            {doc.id}
                          </span>
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {formatDocType(doc.type)}
                          </span>
                          {isWithdrawn && (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-rose-900/80 text-rose-200 border border-rose-700 font-bold">
                              <AlertOctagon className="w-3 h-3 text-rose-400" />
                              RETRACTED
                            </span>
                          )}
                        </div>

                        <h3
                          className={`text-xs font-semibold ${
                            isWithdrawn ? 'text-rose-200/80 line-through' : 'text-slate-200'
                          }`}
                        >
                          {doc.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1 text-[11px] font-mono text-terminal-dim whitespace-nowrap">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>{formatDate(doc.date)}</span>
                      </div>
                    </div>

                    {/* Excerpt */}
                    <div
                      className={`p-2.5 rounded text-xs leading-relaxed font-mono ${
                        isWithdrawn
                          ? 'bg-rose-950/40 text-rose-300/80 border border-rose-900/50 line-through'
                          : 'bg-terminal-bg text-slate-300 border border-slate-800'
                      }`}
                    >
                      "{doc.excerpt}"
                    </div>

                    {/* Withdrawn Impact Banner */}
                    {isWithdrawn && (
                      <div className="p-2 rounded bg-rose-900/40 border border-rose-700/60 flex items-start gap-2 text-xs text-rose-200 font-sans">
                        <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">Withdrawn from source system: </span>
                          <span>
                            This document has been superseded or retracted. {invalidatedCount} claim{invalidatedCount !== 1 ? 's' : ''} invalidated.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <div className="p-3 border-t border-terminal-border bg-terminal-panel/60 text-[11px] font-mono text-terminal-dim flex items-center justify-between">
            <span>Deterministic link verification</span>
            <span className="text-cyan-400">Read-only fixture</span>
          </div>
        </div>
      </div>
    </div>
  );
}
