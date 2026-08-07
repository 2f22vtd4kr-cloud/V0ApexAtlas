import React, { createContext, useContext, useState } from 'react';

// ─── Shared types ─────────────────────────────────────────────────────────────
// Mirror the shapes returned by the API

export interface MctsStep {
  step: number;
  action: string;
  registry: string;
  target: string;
  targetType: string;
  uctScore: number;
  warmthScore: number;
  reasoning: string;
}

export interface PathStep {
  vertexId: string;
  label: string;
  nodeType: string;
  role: 'TARGET' | 'GATEKEEPER' | 'INTERMEDIARY' | 'ASSET';
  contactMethod?: string;
  registry?: string;
  actionRequired?: string;
  contactConfidence?: number | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface SessionData {
  id: number;
  targetEntityName: string | null;
  winningPath: PathStep[];
  mctsSteps: MctsStep[];
  pathScore: number;
}

// ─── Context value ────────────────────────────────────────────────────────────

interface SelectionContextValue {
  selectedEntityId: number | null;
  selectedEntityName: string | null;
  setSelectedEntity: (id: number, name: string) => void;
  clearSelectedEntity: () => void;
  latestSession: SessionData | null;
  setLatestSession: (s: SessionData | null) => void;
}

const SelectionContext = createContext<SelectionContextValue>({
  selectedEntityId: null,
  selectedEntityName: null,
  setSelectedEntity: () => {},
  clearSelectedEntity: () => {},
  latestSession: null,
  setLatestSession: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [selectedEntityName, setSelectedEntityName] = useState<string | null>(null);
  const [latestSession, setLatestSession] = useState<SessionData | null>(null);

  const setSelectedEntity = (id: number, name: string) => {
    setSelectedEntityId(id);
    setSelectedEntityName(name);
  };

  const clearSelectedEntity = () => {
    setSelectedEntityId(null);
    setSelectedEntityName(null);
  };

  return (
    <SelectionContext.Provider
      value={{
        selectedEntityId,
        selectedEntityName,
        setSelectedEntity,
        clearSelectedEntity,
        latestSession,
        setLatestSession,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSelection() {
  return useContext(SelectionContext);
}
