import type { Manifold, Mat4 } from 'manifold-3d';
import { defaultConnectorParams } from './connectors';
import { cutByPlane } from './cut';
import type { Operation, PartId, Technology, Vec3 } from './types';
import type { Wasm } from './wasm';

const dims = (m: Manifold) => {
  const b = m.boundingBox();
  return [0, 1, 2].map((k) => b.max[k] - b.min[k]);
};

/** Fits the build volume if its sizes, sorted, fit the volume's sizes, sorted (90° turns allowed). */
export function fitsVolume(size: number[], volume: number[]) {
  const s = [...size].sort((a, b) => b - a), v = [...volume].sort((a, b) => b - a);
  return s.every((x, i) => x <= v[i] + 1e-6);
}

/** Which axis to cut next and the allowed piece length along it. */
function nextAxis(size: number[], volume: number[]): { axis: number; limit: number } | null {
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const v = [...volume].sort((a, b) => b - a);
  for (let i = 0; i < 3; i++) if (size[order[i]] > v[i] + 1e-6) return { axis: order[i], limit: v[i] };
  return null;
}

/** Cross-section area of `m` at `pos` along `axis` (narrow = hidden/cheap seams). */
function sectionArea(m: Manifold, axis: number, pos: number) {
  // Cyclic axis permutation (a rotation) that brings `axis` onto Z, so slice() applies.
  const toZ: Mat4[] = [
    [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1], // x→z
    [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1], // y→z
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  ];
  const rotated = m.transform(toZ[axis]);
  const b = rotated.boundingBox();
  const cs = rotated.slice(Math.min(b.max[2] - 1e-3, Math.max(b.min[2] + 1e-3, pos)));
  const area = cs.area();
  cs.delete();
  rotated.delete();
  return area;
}

export interface AutoSplitPlan {
  ops: Operation[];
  cuts: number;
  pieces: number;
}

/**
 * Fewest axis-aligned cuts so every piece fits the printer. Along each axis the number of
 * pieces is the minimum possible; within the freedom left, each cut goes where the
 * cross-section is smallest (necks and narrow spots hide seams and print cleaner).
 * Each cut gets loose dowels (no protrusion, so pieces keep fitting) and a joint number.
 */
export function planAutoSplit(wasm: Wasm, part: Manifold, partId: PartId, volume: Vec3, tech: Technology, margin: number, newId: () => string): AutoSplitPlan {
  const usable = volume.map((v) => v - margin);
  if (usable.some((v) => v <= 10)) throw new Error('Margem grande demais para este volume de impressão.');
  const ops: Operation[] = [];
  const queue: { id: PartId; m: Manifold; owned: boolean }[] = [{ id: partId, m: part, owned: false }];
  let pieces = 0;
  let guard = 0;
  while (queue.length) {
    if (++guard > 200) throw new Error('Divisão automática não convergiu.');
    const cur = queue.pop()!;
    const size = dims(cur.m);
    const next = nextAxis(size, usable);
    if (!next) {
      pieces++;
      if (cur.owned) cur.m.delete();
      continue;
    }
    const { axis, limit } = next;
    const box = cur.m.boundingBox();
    const lo = box.min[axis], hi = box.max[axis];
    const count = Math.ceil((hi - lo) / limit);
    // Even split first; then slide each cut within its slack towards the narrowest section.
    const step = (hi - lo) / count;
    const slack = Math.max(0, (limit - step) * 0.95);
    let prev = lo;
    let rest = cur;
    for (let k = 1; k < count; k++) {
      const ideal = lo + step * k;
      const minPos = Math.max(prev + 1, ideal - slack / 2, hi - (count - k) * limit);
      const maxPos = Math.min(prev + limit, ideal + slack / 2, hi - 1);
      let best = (minPos + maxPos) / 2, bestArea = Infinity;
      for (let s = 0; s <= 10; s++) {
        const pos = minPos + ((maxPos - minPos) * s) / 10;
        const area = sectionArea(rest.m, axis, pos);
        if (area > 0 && area < bestArea * 0.97) { bestArea = area; best = pos; }
      }
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = 1;
      const origin: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      origin[axis] = best;
      const id = newId();
      const { a, b } = cutByPlane(wasm, rest.m, { origin, normal });
      ops.push({ kind: 'cut-plane', id, target: rest.id, plane: { origin, normal } });
      ops.push({ kind: 'connector', id: newId(), joint: id, type: 'dowel', params: defaultConnectorParams(tech) });
      ops.push({ kind: 'label', id: newId(), joint: id, size: 6, depth: 0.6 });
      if (rest.owned) rest.m.delete();
      queue.push({ id: `${id}.a`, m: a, owned: true });
      rest = { id: `${id}.b`, m: b, owned: true };
      prev = best;
    }
    queue.push(rest);
  }
  return { ops, cuts: ops.filter((o) => o.kind === 'cut-plane').length, pieces };
}
