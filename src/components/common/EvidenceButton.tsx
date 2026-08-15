import React from 'react';
import { FileText, AlertTriangle } from 'lucide-react';
import { useEvidence } from '../../context/EvidenceContext';
import { ConfidenceLevel } from '../../types/portfolio';

interface EvidenceButtonProps {
  title: string;
  subtitle?: string;
  docIds: string[] | undefined;
  confidence?: ConfidenceLevel;
  hasRetractedDoc?: boolean;
  variant?: 'inline' | 'button' | 'icon';
  className?: string;
}

export function EvidenceButton({
  title,
  subtitle,
  docIds = [],
  confidence,
  hasRetractedDoc = false,
  variant = 'button',
  className = '',
}: EvidenceButtonProps) {
  const { inspectEvidence } = useEvidence();

  if (!docIds || docIds.length === 0) {
    return null;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    inspectEvidence({
      title,
      subtitle,
      docIds,
      confidence,
    });
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/80 transition-colors ${className}`}
        title={`View ${docIds.length} source document${docIds.length > 1 ? 's' : ''}`}
      >
        <FileText className="w-3.5 h-3.5" />
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 text-[11px] font-mono font-medium px-1.5 py-0.5 rounded border transition-all ${
          hasRetractedDoc
            ? 'bg-rose-950/40 text-rose-300 border-rose-800/60 hover:bg-rose-900/60'
            : 'bg-slate-800/80 text-cyan-300 border-slate-700 hover:bg-slate-700/80 hover:border-cyan-700/60'
        } ${className}`}
      >
        {hasRetractedDoc ? (
          <AlertTriangle className="w-3 h-3 text-rose-400" />
        ) : (
          <FileText className="w-3 h-3 text-cyan-400" />
        )}
        <span>{docIds.length} {docIds.length === 1 ? 'doc' : 'docs'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 text-xs font-mono font-medium px-2 py-1 rounded border transition-all ${
        hasRetractedDoc
          ? 'bg-rose-950/40 text-rose-300 border-rose-800/70 hover:bg-rose-900/60'
          : 'bg-terminal-panel text-slate-300 border-terminal-border hover:text-cyan-300 hover:border-cyan-700/70 hover:bg-slate-800'
      } ${className}`}
    >
      <FileText className="w-3.5 h-3.5 text-cyan-400" />
      <span>Evidence ({docIds.length})</span>
      {hasRetractedDoc && (
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" title="Contains retracted document" />
      )}
    </button>
  );
}
