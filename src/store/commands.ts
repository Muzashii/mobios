import { cutPartIds, pinsPartId } from '../geometry/engine';
import type { Operation, PartId, SourceRef, Technology } from '../geometry/types';
import type { PartMapEdits, PartMeta, ProjectDoc } from './project';

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
  if (op.kind === 'cut-plane' || op.kind === 'cut-surface' || op.kind === 'cut-region') {
    const { a, b } = cutPartIds(op.id);
    return [a, b];
  }
  return [pinsPartId(op.id)];
}

export function consumedParts(op: Operation): PartId[] {
  return op.kind === 'cut-plane' || op.kind === 'cut-surface' || op.kind === 'cut-region' || op.kind === 'hollow' ? [op.target] : [];
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

/** Removes an imported mesh with everything made from it (cuts, connectors, hollowing…). */
export const removeSource = (id: PartId, name: string): Command => ({
  label: `Excluir ${name}`,
  apply: (doc) => {
    let ops = doc.operations;
    for (const op of doc.operations) if (consumedParts(op).includes(id)) ops = removeWithDependents(ops, op.id);
    const partMaps = { ...doc.partMaps };
    delete partMaps[id];
    return { ...doc, sources: doc.sources.filter((s) => s.id !== id), operations: ops, partMaps };
  },
});

/**
 * Imported mesh a part comes from, following its cuts back through the history (a piece of a
 * piece of the figure → the figure). Null for parts that are not made from a mesh (loose pins).
 */
export function sourceOf(doc: ProjectDoc, part: PartId): PartId | null {
  const producer = new Map<PartId, Operation>();
  for (const op of doc.operations) for (const p of producedParts(op)) producer.set(p, op);
  let p = part;
  for (let guard = 0; guard < 1000; guard++) {
    if (doc.sources.some((s) => s.id === p)) return p;
    const op = producer.get(p);
    if (!op || !consumedParts(op).length) return null;
    p = consumedParts(op)[0];
  }
  return null;
}

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

const editMap = (doc: ProjectDoc, id: PartId, fn: (e: PartMapEdits) => PartMapEdits): ProjectDoc => {
  const cur = doc.partMaps?.[id];
  return cur ? { ...doc, partMaps: { ...doc.partMaps, [id]: fn(cur) } } : doc;
};

/** Shows (or hides, keeping nothing) the automatic part map of a part. */
export const showPartMap = (id: PartId, on: boolean): Command => ({
  label: on ? 'Detectar partes' : 'Ocultar partes',
  apply: (doc) => {
    const maps = { ...doc.partMaps };
    if (on) maps[id] ??= { names: {}, merged: {} };
    else delete maps[id];
    return { ...doc, partMaps: maps };
  },
});

export const renameMapPart = (id: PartId, part: number, name: string): Command => ({
  label: 'Renomear parte detectada',
  coalesce: `map-name-${id}-${part}`,
  apply: (doc) => editMap(doc, id, (e) => ({ ...e, names: { ...e.names, [part]: name } })),
});

/** Merges automatic part `from` (and whatever was merged into it) into `into`'s group. */
export const mergeMapParts = (id: PartId, from: number, into: number, label: string): Command => ({
  label,
  apply: (doc) =>
    editMap(doc, id, (e) => {
      const target = resolveMapPart(e, into);
      const source = resolveMapPart(e, from);
      if (target === source) return e;
      const merged = { ...e.merged };
      for (const [k, v] of Object.entries(merged)) if (v === source) merged[+k] = target;
      merged[source] = target;
      return { ...e, merged };
    }),
});

/** Takes an automatic part back out of the group it was merged into. */
export const unmergeMapPart = (id: PartId, part: number, label: string): Command => ({
  label,
  apply: (doc) =>
    editMap(doc, id, (e) => {
      const merged = { ...e.merged };
      delete merged[part];
      return { ...e, merged };
    }),
});

/** Group (root automatic part) an automatic part belongs to after the user's merges. */
export function resolveMapPart(e: PartMapEdits, part: number): number {
  let p = part;
  for (let guard = 0; guard < 64 && e.merged[p] !== undefined && e.merged[p] !== p; guard++) p = e.merged[p];
  return p;
}
