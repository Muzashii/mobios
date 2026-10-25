import type { PartMapResult } from '../../geometry/types';
import { resolveMapPart } from '../../store/commands';
import type { PartMapEdits } from '../../store/project';
import { mapPartColor } from '../../ui/tokens';

/** A detected part as the user sees it: an automatic part plus whatever was merged into it. */
export interface MapGroup {
  /** Root automatic part id. */
  id: number;
  name: string;
  /** Share of the surface (0–1). */
  share: number;
  color: string;
  /** Automatic parts in the group, root first. */
  members: number[];
}

/** Groups after the user's merges, biggest first. */
export function mapGroups(result: PartMapResult, edits: PartMapEdits): MapGroup[] {
  const byRoot = new Map<number, MapGroup>();
  for (const p of result.parts) {
    const root = resolveMapPart(edits, p.id);
    let g = byRoot.get(root);
    if (!g) {
      const auto = result.parts.find((q) => q.id === root);
      byRoot.set(root, (g = { id: root, name: edits.names[root] ?? auto?.name ?? `Parte ${root + 1}`, share: 0, color: mapPartColor(root), members: [] }));
    }
    g.share += p.share;
    if (p.id === root) g.members.unshift(p.id);
    else g.members.push(p.id);
  }
  return [...byRoot.values()].sort((a, b) => b.share - a.share);
}

/** Root group per automatic part id (lookup table for colouring and picking). */
export function groupOf(result: PartMapResult, edits: PartMapEdits): Int32Array {
  const out = new Int32Array(result.parts.length);
  for (const p of result.parts) out[p.id] = resolveMapPart(edits, p.id);
  return out;
}

/**
 * Order to cut the groups off so what is left always stays in one piece: peel the outside first
 * (a group touching a single remaining group — hat, hand, base), smallest first. The last group
 * left (the torso, usually) is the body and is not cut.
 */
export function peelOrder(map: PartMapResult, edits: PartMapEdits, groups: { id: number; share: number }[]): number[] {
  const root = (id: number) => resolveMapPart(edits, id);
  const nbrs = new Map<number, Set<number>>(groups.map((g) => [g.id, new Set<number>()]));
  for (const p of map.parts)
    for (const q of p.touches ?? []) {
      const a = root(p.id), b = root(q);
      if (a !== b && nbrs.has(a) && nbrs.has(b)) nbrs.get(a)!.add(b);
    }
  const share = new Map(groups.map((g) => [g.id, g.share]));
  const left = new Set(groups.map((g) => g.id));
  const order: number[] = [];
  while (left.size > 1) {
    const degree = (g: number) => [...nbrs.get(g)!].filter((n) => left.has(n)).length;
    const pool = [...left];
    const leaves = pool.filter((g) => degree(g) <= 1);
    const next = (leaves.length ? leaves : pool).sort((a, b) => share.get(a)! - share.get(b)!)[0];
    order.push(next);
    left.delete(next);
  }
  return order;
}
