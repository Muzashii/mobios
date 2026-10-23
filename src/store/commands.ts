import { cutPartIds, pinsPartId } from '../geometry/engine';
import type { Operation, PartId, SourceRef, Technology } from '../geometry/types';
import type { PartMeta, ProjectDoc } from './project';

/** Every state change is a Command: a label (shown in undo) and a pure doc -> doc function. */
export interface Command {
  label: string;
  apply: (doc: ProjectDoc) => ProjectDoc;
  /** Consecutive commands with the same key (within a short window) merge into one undo step. */
  coalesce?: string;
}

/** Several commands as one undo step. */
export const batch = (label: string, cmds: Command[]): Command => ({
  label,
  apply: (doc) => cmds.reduce((d, c) => c.apply(d), doc),
});

export const addSources =(sources: SourceRef[]): Command => ({
  label: sources.length === 1 ? `Importar ${sources[0].name}` : `Importar ${sources.length} malhas`,
  apply: (doc) => ({
    ...doc,
    name: doc.sources.length === 0 && doc.name === 'Sem título' ? sources[0].name : doc.name,
    sources: [...doc.sources, ...sources],
  }),
});

export const addOperation = (op: Operation, label: string): Command => ({
  label,
  apply: (doc) => ({ ...doc, operations: [...doc.operations, op] }),
});

/** Inserts right after another operation (e.g. connector right after its cut). */
export const insertOperationAfter = (afterId: string, op: Operation, label: string): Command => ({
  label,
  apply: (doc) => {
    const i = doc.operations.findIndex((o) => o.id === afterId);
    const ops = [...doc.operations];
    ops.splice(i < 0 ? ops.length : i + 1, 0, op);
    return { ...doc, operations: ops };
  },
});

export const updateOperation = (op: Operation, label: string, coalesce?: string): Command => ({
  label,
  coalesce,
  apply: (doc) => ({ ...doc, operations: doc.operations.map((o) => (o.id === op.id ? op : o)) }),
});

/** Parts produced by an operation (used for cascading deletes). */
export function producedParts(op: Operation): PartId[] {
  if (op.kind === 'cut-plane' || op.kind === 'cut-surface') {
    const { a, b } = cutPartIds(op.id);
    return [a, b];
  }
  return [pinsPartId(op.id)];
}

export function consumedParts(op: Operation): PartId[] {
  return op.kind === 'cut-plane' || op.kind === 'cut-surface' ? [op.target] : [];
}

/** Removes an operation and everything that depends on what it produced. */
export function removeWithDependents(ops: Operation[], id: string): Operation[] {
  const removed = new Set([id]);
  const deadParts = new Set<PartId>();
  const out: Operation[] = [];
  for (const op of ops) {
    const dependsOnRemoved =
      removed.has(op.id) ||
      consumedParts(op).some((p) => deadParts.has(p)) ||
      ((op.kind === 'connector' || op.kind === 'label') && removed.has(op.joint));
    if (dependsOnRemoved) {
      removed.add(op.id);
      producedParts(op).forEach((p) => deadParts.add(p));
      continue;
    }
    out.push(op);
  }
  return out;
}

export const removeOperation = (id: string, label: string): Command => ({
  label,
  apply: (doc) => ({ ...doc, operations: removeWithDependents(doc.operations, id) }),
});

export const removeSource = (id: PartId, name: string): Command => ({
  label: `Remover ${name}`,
  apply: (doc) => {
    let ops = doc.operations;
    for (const op of doc.operations) if ((op.kind === 'cut-plane' || op.kind === 'cut-surface') && op.target === id) ops = removeWithDependents(ops, op.id);
    return { ...doc, sources: doc.sources.filter((s) => s.id !== id), operations: ops };
  },
});

export const setPartMeta = (id: PartId, patch: PartMeta, label: string, coalesce?: string): Command => ({
  label,
  coalesce,
  apply: (doc) => ({ ...doc, partMeta: { ...doc.partMeta, [id]: { ...doc.partMeta[id], ...patch } } }),
});

export const renameProject = (name: string): Command => ({
  label: 'Renomear projeto',
  coalesce: 'project-name',
  apply: (doc) => ({ ...doc, name }),
});

export const setTechnology = (technology: Technology): Command => ({
  label: `Tecnologia: ${technology === 'FDM' ? 'FDM' : 'Resina'}`,
  apply: (doc) => ({ ...doc, technology }),
});

export const setPrinter = (printerId: string, technology: Technology): Command => ({
  label: 'Trocar impressora',
  apply: (doc) => ({ ...doc, printerId, technology }),
});

export const setClearance = (technology: Technology, value: number): Command => ({
  label: 'Folga padrão',
  coalesce: `clearance-${technology}`,
  apply: (doc) => ({ ...doc, clearance: { ...doc.clearance, [technology]: value } }),
});

export const setFilament = (slot: number, color: string): Command => ({
  label: `Cor do slot ${slot}`,
  coalesce: `filament-${slot}`,
  apply: (doc) => ({ ...doc, filaments: doc.filaments.map((c, i) => (i === slot - 1 ? color : c)) }),
});
