import type { Manifold } from 'manifold-3d';
import type { MeshData } from '../types';
import type { Wasm } from '../wasm';

/**
 * Volumetric remesh — the fallback that always yields a closed manifold, whatever the input
 * (holes, self-intersections, overlapping or inverted shells, non-manifold junk).
 *
 * 1. Each voxel centre is classified by casting rays along X, Y and Z through its column and
 *    counting signed crossings (winding number: overlapping shells stay solid). A ray that slips
 *    through a hole gets the wrong answer, so the three axes vote (2 of 3 wins).
 * 2. The occupancy is blurred once and turned into a surface with `Manifold.levelSet`.
 *
 * Detail smaller than one voxel (longest side / resolution) is lost; the UI says so.
 */
export function volumetricRemesh(wasm: Wasm, mesh: MeshData, resolution = 128): { manifold: Manifold; voxel: number } {
  const { positions: p, indices: t } = mesh;
  const nf = t.length / 3;
  if (!nf) throw new Error('Malha vazia.');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[i + k]);
    hi[k] = Math.max(hi[k], p[i + k]);
  }
  const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const h = longest / resolution;
  const pad = 2;
  const origin = lo.map((v) => v - pad * h);
  const dims = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / h) + 2 * pad + 1);
  const [nx, ny, nz] = dims;
  const votes = new Uint8Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  // Per axis a: the column plane uses axes (b, c); rays run along a.
  for (const a of [0, 1, 2]) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const nb = dims[b], nc = dims[c], na = dims[a];
    // Tiny irrational offset keeps columns off triangle edges and vertices.
    const jb = h * 0.0137, jc = h * 0.0071;
    const colB = (x: number) => (x - origin[b] - jb) / h - 0.5;
    const colC = (x: number) => (x - origin[c] - jc) / h - 0.5;
    const counts = new Uint32Array(nb * nc + 1);
    const range = (f: number) => {
      let b0 = Infinity, b1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = t[f * 3 + k] * 3;
        b0 = Math.min(b0, p[v + b]); b1 = Math.max(b1, p[v + b]);
        c0 = Math.min(c0, p[v + c]); c1 = Math.max(c1, p[v + c]);
      }
      return [Math.max(0, Math.ceil(colB(b0))), Math.min(nb - 1, Math.floor(colB(b1))), Math.max(0, Math.ceil(colC(c0))), Math.min(nc - 1, Math.floor(colC(c1)))];
    };
    for (let f = 0; f < nf; f++) {
      const [i0, i1, k0, k1] = range(f);
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) counts[k * nb + i + 1]++;
    }
    for (let i = 0; i < nb * nc; i++) counts[i + 1] += counts[i];
    const fill = counts.slice(0, nb * nc);
    const items = new Uint32Array(counts[nb * nc]);
    for (let f = 0; f < nf; f++) {
      const [i0, i1, k0, k1] = range(f);
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) items[fill[k * nb + i]++] = f;
    }
    const hits: { s: number; w: number }[] = [];
    for (let kc = 0; kc < nc; kc++) for (let ib = 0; ib < nb; ib++) {
      const col = kc * nb + ib;
      if (counts[col] === counts[col + 1]) continue;
      const x = origin[b] + (ib + 0.5) * h + jb, y = origin[c] + (kc + 0.5) * h + jc;
      hits.length = 0;
      for (let q = counts[col]; q < counts[col + 1]; q++) {
        const f = items[q];
        const v0 = t[f * 3] * 3, v1 = t[f * 3 + 1] * 3, v2 = t[f * 3 + 2] * 3;
        const x0 = p[v0 + b], y0 = p[v0 + c], x1 = p[v1 + b], y1 = p[v1 + c], x2 = p[v2 + b], y2 = p[v2 + c];
        const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (det === 0) continue;
        const l1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / det;
        const l2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / det;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const s = p[v0 + a] + (p[v1 + a] - p[v0 + a]) * l1 + (p[v2 + a] - p[v0 + a]) * l2;
        // det > 0 ⇔ normal along +a (right-handed b, c, a): leaving the solid.
        hits.push({ s, w: det > 0 ? -1 : 1 });
      }
      if (!hits.length) continue;
      hits.sort((u, v) => u.s - v.s);
      let w = 0, hi2 = 0;
      for (let ka = 0; ka < na; ka++) {
        const s = origin[a] + (ka + 0.5) * h;
        while (hi2 < hits.length && hits[hi2].s < s) w += hits[hi2++].w;
        if (w > 0) {
          const idx = [0, 0, 0];
          idx[a] = ka; idx[b] = ib; idx[c] = kc;
          votes[at(idx[0], idx[1], idx[2])]++;
        }
      }
    }
  }

  // Occupancy (2 of 3 axes), blurred once (3×3×3 box) for a smoother level set.
  const occ = new Float32Array(nx * ny * nz);
  for (let i = 0; i < occ.length; i++) occ[i] = votes[i] >= 2 ? 1 : 0;
  const field = new Float32Array(occ.length);
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    let sum = 0;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const wgt = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1) * (dk === 0 ? 2 : 1);
      sum += occ[at(i + di, j + dj, k + dk)] * wgt;
    }
    field[at(i, j, k)] = sum / 64;
  }
  const sample = (x: number, y: number, z: number) => {
    const fx = (x - origin[0]) / h - 0.5, fy = (y - origin[1]) / h - 0.5, fz = (z - origin[2]) / h - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return 0;
    const u = fx - i, v = fy - j, w = fz - k;
    const g = (di: number, dj: number, dk: number) => field[at(i + di, j + dj, k + dk)];
    const c00 = g(0, 0, 0) * (1 - u) + g(1, 0, 0) * u, c10 = g(0, 1, 0) * (1 - u) + g(1, 1, 0) * u;
    const c01 = g(0, 0, 1) * (1 - u) + g(1, 0, 1) * u, c11 = g(0, 1, 1) * (1 - u) + g(1, 1, 1) * u;
    return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
  };
  const manifold = wasm.Manifold.levelSet(
    ([x, y, z]) => sample(x, y, z) - 0.5,
    { min: [origin[0], origin[1], origin[2]], max: [origin[0] + nx * h, origin[1] + ny * h, origin[2] + nz * h] },
    h,
  );
  if (manifold.isEmpty()) {
    manifold.delete();
    throw new Error('O remesh volumétrico não encontrou volume: a malha não envolve nenhum espaço.');
  }
  return { manifold, voxel: h };
}
