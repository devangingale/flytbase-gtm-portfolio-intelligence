import { createContext, useContext, useState, ReactNode } from 'react';
import { ConfidenceLevel } from '../types/portfolio';

export interface EvidenceTarget {
  title: string;
  subtitle?: string;
  docIds: string[];
  confidence?: ConfidenceLevel;
}

interface EvidenceContextType {
  target: EvidenceTarget | null;
  isOpen: boolean;
  inspectEvidence: (target: EvidenceTarget) => void;
  closeEvidence: () => void;
}

const EvidenceContext = createContext<EvidenceContextType | undefined>(undefined);

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<EvidenceTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const inspectEvidence = (newTarget: EvidenceTarget) => {
    setTarget(newTarget);
    setIsOpen(true);
  };

  const closeEvidence = () => {
    setIsOpen(false);
  };

  return (
    <EvidenceContext.Provider value={{ target, isOpen, inspectEvidence, closeEvidence }}>
      {children}
    </EvidenceContext.Provider>
  );
}

export function useEvidence() {
  const context = useContext(EvidenceContext);
  if (!context) {
    throw new Error('useEvidence must be used within an EvidenceProvider');
  }
  return context;
}
