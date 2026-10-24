import type { MeshQuery } from '../mesh/bvh';
import type { Topology } from '../mesh/topology';
import type { MeshData, Vec3 } from '../types';

/**
 * Volumetric shape measures for the part map. The solid is voxelised once; local thickness
 * (diameter of the largest inscribed ball containing a point) is what tells an arm from the
 * torso or a hat brim from the head even where no crease separates them.
 */
/** Inside/outside voxel grid of a closed mesh (one parity ray per column). */
export class SolidGrid {
  readonly n: [number, number, number];
  readonly min: Vec3;
  readonly h: number;
  readonly inside: Uint8Array;

  constructor(mesh: MeshData, query: MeshQuery, h: number) {
    const p = mesh.positions;
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
    this.h = h;
    this.min = [lo[0] - 2 * h, lo[1] - 2 * h, lo[2] - 2 * h];
    this.n = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / h) + 4) as [number, number, number];
    const [nx, ny, nz] = this.n;
    const inside = new Uint8Array(nx * ny * nz);
    // One ray per (y, z) column along +X; parity of crossings fills the inside runs.
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      const o: Vec3 = [this.min[0] - h, this.min[1] + (y + 0.5) * h, this.min[2] + (z + 0.5) * h];
      const hits = query.hits(o, [1, 0, 0]);
      let prev = -Infinity;
      const xs: number[] = [];
      for (const hh of hits) if (hh.distance - prev > 1e-6) { xs.push(o[0] + hh.distance); prev = hh.distance; }
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, Math.ceil((xs[i] - this.min[0]) / h - 0.5));
        const b = Math.min(nx - 1, Math.floor((xs[i + 1] - this.min[0]) / h - 0.5));
        for (let x = a; x <= b; x++) inside[x + nx * (y + ny * z)] = 1;
      }
    }
    this.inside = inside;
  }
}

/** Exact squared Euclidean distance transform (Felzenszwalb–Huttenlocher), in voxels², to the outside. */
export function distanceTransform(inside: Uint8Array, n: [number, number, number]): Float32Array {
  const [nx, ny, nz] = n;
  const INF = 1e20;
  const d = new Float32Array(nx * ny * nz);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? INF : 0;
  const len = Math.max(nx, ny, nz);
  const f = new Float64Array(len), out = new Float64Array(len), z = new Float64Array(len + 1);
  const v = new Int32Array(len);
  const pass = (count: number, stride: number, starts: (cb: (s: number) => void) => void) => {
    starts((s) => {
      for (let i = 0; i < count; i++) f[i] = d[s + i * stride];
      edt1d(f, count, out, v, z);
      for (let i = 0; i < count; i++) d[s + i * stride] = out[i];
    });
  };
  pass(nx, 1, (cb) => { for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) cb(nx * (j + ny * k)); });
  pass(ny, nx, (cb) => { for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) cb(i + nx * ny * k); });
  pass(nz, nx * ny, (cb) => { for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cb(i + nx * j); });
  return d;
}

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Local thickness (Hildebrand & Rüegsegger): for every inside voxel, the radius (voxels) of the
 * largest inscribed ball that contains it. Balls are painted from the medial ridge of the
 * distance transform, biggest first; balls nested inside an already painted one are skipped.
 */
export function localThickness(inside: Uint8Array, n: [number, number, number]): Float32Array {
  const [nx, ny, nz] = n;
  const d2 = distanceTransform(inside, n);
  const r = new Float32Array(d2.length);
  for (let i = 0; i < d2.length; i++) r[i] = Math.sqrt(d2[i]);
  // Centres of maximal balls: no 6-neighbour's ball swallows this one (r[n] ≥ r + 1 would).
  const ridge: number[] = [];
  const sxy = nx * ny;
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const c = i + nx * j + sxy * k;
    const rc = r[c];
    if (rc < 1) continue;
    const m = rc + 0.8;
    if (r[c + 1] >= m || r[c - 1] >= m || r[c + nx] >= m || r[c - nx] >= m || r[c + sxy] >= m || r[c - sxy] >= m) continue;
    ridge.push(c);
  }
  ridge.sort((a, b) => r[b] - r[a]);
  const out = new Float32Array(d2.length);
  for (const c of ridge) {
    const R = r[c];
    const ci = c % nx, cj = Math.floor(c / nx) % ny, ck = Math.floor(c / sxy);
    const Ri = Math.ceil(R), R2 = R * R;
    for (let dk = -Ri; dk <= Ri; dk++) {
      const k = ck + dk;
      if (k < 0 || k >= nz) continue;
      for (let dj = -Ri; dj <= Ri; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= ny) continue;
        const rest = R2 - dk * dk - dj * dj;
        if (rest < 0) continue;
        const w = Math.floor(Math.sqrt(rest));
        const row = nx * j + sxy * k;
        for (let i = Math.max(0, ci - w), e = Math.min(nx - 1, ci + w); i <= e; i++) if (out[row + i] < R) out[row + i] = R;
      }
    }
  }
  return out;
}

/** Local thickness (mm, ball diameter) seen from each face: sampled just under its centroid. */
export function faceThickness(topo: Topology, grid: SolidGrid, lt: Float32Array): Float32Array {
  const { nf, p, t, fNormal: n } = topo;
  const [nx, ny, nz] = grid.n;
  const h = grid.h;
  const out = new Float32Array(nf);
  for (let f = 0; f < nf; f++) {
    let best = 0;
    for (const depth of [0.5, 1, 1.5]) {
      let i = 0, j = 0, k = 0;
      for (let a = 0; a < 3; a++) {
        const c = (p[t[f * 3] * 3 + a] + p[t[f * 3 + 1] * 3 + a] + p[t[f * 3 + 2] * 3 + a]) / 3 - n[f * 3 + a] * depth * h;
        const idx = Math.floor((c - grid.min[a]) / h);
        if (a === 0) i = idx; else if (a === 1) j = idx; else k = idx;
      }
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
      best = Math.max(best, lt[i + nx * (j + ny * k)]);
    }
    out[f] = 2 * best * h;
  }
  return out;
}
