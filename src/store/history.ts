import { create } from 'zustand';
import type { Command } from './commands';
import { createProject, type ProjectDoc } from './project';

interface Entry {
  doc: ProjectDoc;
  label: string;
}

interface HistoryState {
  doc: ProjectDoc;
  past: Entry[];
  future: Entry[];
  lastCoalesce?: { key: string; at: number };
  dispatch: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  /** Replaces the document and clears history (open / new project). */
  load: (doc: ProjectDoc) => void;
}

const COALESCE_MS = 900;
const LIMIT = 500;

/** Undo/redo over immutable document snapshots (structural sharing keeps them cheap). */
export const useHistory = create<HistoryState>((set, get) => ({
  doc: createProject(),
  past: [],
  future: [],
  dispatch: (cmd) => {
    const { doc, past, lastCoalesce } = get();
    const next = cmd.apply(doc);
    if (next === doc) return;
    const now = Date.now();
    const merge = cmd.coalesce && lastCoalesce?.key === cmd.coalesce && now - lastCoalesce.at < COALESCE_MS && past.length > 0;
    set({
      doc: next,
      past: merge ? past : [...past, { doc, label: cmd.label }].slice(-LIMIT),
      future: [],
      lastCoalesce: cmd.coalesce ? { key: cmd.coalesce, at: now } : undefined,
    });
  },
  undo: () => {
    const { past, doc, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ doc: prev.doc, past: past.slice(0, -1), future: [{ doc, label: prev.label }, ...future], lastCoalesce: undefined });
  },
  redo: () => {
    const { past, doc, future } = get();
    const next = future[0];
    if (!next) return;
    set({ doc: next.doc, past: [...past, { doc, label: next.label }], future: future.slice(1), lastCoalesce: undefined });
  },
  load: (doc) => set({ doc, past: [], future: [], lastCoalesce: undefined }),
}));

export const dispatch = (cmd: Command) => useHistory.getState().dispatch(cmd);
export const getDoc = () => useHistory.getState().doc;
