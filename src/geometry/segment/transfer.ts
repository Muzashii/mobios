import { MeshQuery } from '../mesh/bvh';
import type { MeshData, Vec3 } from '../types';

/**
 * Carries per-face labels from an analysis proxy (simplified mesh) to the full mesh: proxy
 * triangles are splatted into a voxel grid, the labels grow a few voxels outwards (the full
 * surface sits within the simplification tolerance of the proxy), and each full-mesh face takes
 * the label of the voxel under its centroid. Faces that land on an empty voxel fall back to the
 * closest proxy face. O(faces) for millions of triangles.
 */
export function transferLabels(proxy: MeshData, labels: ArrayLike<number>, full: MeshData, maxCells = 4_000_000): Uint16Array {
  const pp = proxy.positions, pt = proxy.indices;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of [pp, full.positions]) for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[i + k]);
    hi[k] = Math.max(hi[k], p[i + k]);
  }
  let edge = 0;
  for (let f = 0; f < pt.length / 3; f++) edge += dist(pp, pt[f * 3], pt[f * 3 + 1]);
  edge /= Math.max(1, pt.length / 3);
  const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  const h = Math.max(edge * 0.5, Math.cbrt(vol / maxCells), 1e-6);
  const n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / h) + 1));
  const [nx, ny, nz] = n;
  const cell = new Int32Array(nx * ny * nz).fill(-1);
  const at = (x: number, y: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - lo[0]) / h)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - lo[1]) / h)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - lo[2]) / h)));
    return i + nx * (j + ny * k);
  };
  // Splat proxy triangles (barycentric samples no farther apart than a voxel).
  const queue: number[] = [];
  for (let f = 0; f < pt.length / 3; f++) {
    const a = pt[f * 3] * 3, b = pt[f * 3 + 1] * 3, c = pt[f * 3 + 2] * 3;
    const steps = Math.max(1, Math.ceil(Math.max(dist(pp, pt[f * 3], pt[f * 3 + 1]), dist(pp, pt[f * 3 + 1], pt[f * 3 + 2]), dist(pp, pt[f * 3 + 2], pt[f * 3])) / h));
    for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
      const u = i / steps, v = j / steps, w = 1 - u - v;
      const id = at(pp[a] * w + pp[b] * u + pp[c] * v, pp[a + 1] * w + pp[b + 1] * u + pp[c + 1] * v, pp[a + 2] * w + pp[b + 2] * u + pp[c + 2] * v);
      if (cell[id] < 0) {
        cell[id] = labels[f];
        queue.push(id);
      }
    }
  }
  // Grow labels a few voxels (breadth-first, 6-neighbourhood).
  let front = queue;
  for (let step = 0; step < 4 && front.length; step++) {
    const next: number[] = [];
    for (const id of front) {
      const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
      const nb = [i > 0 ? id - 1 : -1, i < nx - 1 ? id + 1 : -1, j > 0 ? id - nx : -1, j < ny - 1 ? id + nx : -1, k > 0 ? id - nx * ny : -1, k < nz - 1 ? id + nx * ny : -1];
      for (const m of nb) if (m >= 0 && cell[m] < 0) {
        cell[m] = cell[id];
        next.push(m);
      }
    }
    front = next;
  }
  const fp = full.positions, ft = full.indices;
  const nf = ft.length / 3;
  const out = new Uint16Array(nf);
  let query: MeshQuery | null = null;
  for (let f = 0; f < nf; f++) {
    const a = ft[f * 3] * 3, b = ft[f * 3 + 1] * 3, c = ft[f * 3 + 2] * 3;
    const x = (fp[a] + fp[b] + fp[c]) / 3, y = (fp[a + 1] + fp[b + 1] + fp[c + 1]) / 3, z = (fp[a + 2] + fp[b + 2] + fp[c + 2]) / 3;
    let l = cell[at(x, y, z)];
    if (l < 0) {
      query ??= new MeshQuery(proxy);
      const hit = query.closest([x, y, z]);
      l = hit ? labels[hit.face] : 0;
    }
    out[f] = l;
  }
  query?.dispose();
  return out;
}

const dist = (p: ArrayLike<number>, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
