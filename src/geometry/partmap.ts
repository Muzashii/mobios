import type { Manifold } from 'manifold-3d';
import { manifoldToMeshData } from './repair';
import { buildPartMap } from './segment/parts';
import { transferLabels } from './segment/transfer';
import type { MeshData, PartMapResult } from './types';

/**
 * Part map of a manifold (see segment/parts.ts): segmented on an analysis proxy of ~45k
 * triangles (manifold simplification), then carried to every triangle of the manifold's mesh in
 * `manifoldToMeshData` order, which is also the display mesh order.
 */
/** Target size of the analysis proxy (triangles). */
const PROXY_FACES = 45_000;

export function partMapOf(m: Manifold, onProxy?: (proxy: MeshData) => void): PartMapResult {
  const t0 = performance.now();
  const full = manifoldToMeshData(m);
  let work: Manifold = m;
  if (m.numTri() > PROXY_FACES * 1.5) {
    // Gentle steps (×1.3) so the proxy keeps creases and thin plates; validated on the lab
    // corpus at 30k–70k faces (tests/lab/robust.lab.ts).
    const box = m.boundingBox();
    const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    for (let tol = diag * 2e-4; tol < diag * 0.05 && work.numTri() > PROXY_FACES; tol *= 1.3) {
      const s = work.simplify(tol);
      if (work !== m) work.delete();
      work = s;
    }
  }
  const proxy = work === m ? full : manifoldToMeshData(work);
  if (work !== m) work.delete();
  onProxy?.(proxy);
  const map = buildPartMap(proxy);
  const labels = proxy === full ? Uint16Array.from(map.facePart) : transferLabels(proxy, map.facePart, full);
  const total = map.parts.reduce((s, p) => s + p.area, 0) || 1;
  return {
    labels,
    parts: map.parts.map((p) => ({ id: p.id, name: p.name, share: p.area / total, centroid: p.centroid })),
    ms: Math.round(performance.now() - t0),
  };
}
