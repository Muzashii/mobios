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
