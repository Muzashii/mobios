/**
 * Triangle–triangle intersection (Möller 1997, interval overlap on the planes' intersection
 * line). Coplanar pairs are reported as not intersecting: callers use it to find crossings
 * (self-intersections, a cap piercing the surface), where coplanar contact is harmless.
 * Triangles are given as 9 numbers (x0 y0 z0 x1 … z2).
 */
export function trianglesIntersect(A: ArrayLike<number>, B: ArrayLike<number>, eps = 1e-9): boolean {
  const n2 = normal(B);
  const d2 = -(n2[0] * B[0] + n2[1] * B[1] + n2[2] * B[2]);
  const scaleB = Math.hypot(n2[0], n2[1], n2[2]);
  if (scaleB === 0) return false;
  const da = [0, 1, 2].map((k) => snap((n2[0] * A[k * 3] + n2[1] * A[k * 3 + 1] + n2[2] * A[k * 3 + 2] + d2) / scaleB, eps));
  if ((da[0] > 0 && da[1] > 0 && da[2] > 0) || (da[0] < 0 && da[1] < 0 && da[2] < 0)) return false;

  const n1 = normal(A);
  const d1 = -(n1[0] * A[0] + n1[1] * A[1] + n1[2] * A[2]);
  const scaleA = Math.hypot(n1[0], n1[1], n1[2]);
  if (scaleA === 0) return false;
  const db = [0, 1, 2].map((k) => snap((n1[0] * B[k * 3] + n1[1] * B[k * 3 + 1] + n1[2] * B[k * 3 + 2] + d1) / scaleA, eps));
  if ((db[0] > 0 && db[1] > 0 && db[2] > 0) || (db[0] < 0 && db[1] < 0 && db[2] < 0)) return false;
  if (da[0] === 0 && da[1] === 0 && da[2] === 0) return false; // coplanar

  // Project onto the dominant axis of the intersection line.
  const D = [n1[1] * n2[2] - n1[2] * n2[1], n1[2] * n2[0] - n1[0] * n2[2], n1[0] * n2[1] - n1[1] * n2[0]];
  const ax = Math.abs(D[0]) > Math.abs(D[1]) ? (Math.abs(D[0]) > Math.abs(D[2]) ? 0 : 2) : Math.abs(D[1]) > Math.abs(D[2]) ? 1 : 2;
  const pa = [A[ax], A[3 + ax], A[6 + ax]];
  const pb = [B[ax], B[3 + ax], B[6 + ax]];
  const ia = interval(pa, da);
  const ib = interval(pb, db);
  if (!ia || !ib) return false;
  // Strict overlap: touching at a point/edge is not a crossing.
  const tol = eps * 10;
  return Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0]) > tol;
}

const snap = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x);

function normal(T: ArrayLike<number>): [number, number, number] {
  const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
  const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Interval of a triangle on the line, from its projected vertices and plane distances. */
function interval(p: number[], d: number[]): [number, number] | null {
  let k: number;
  if (d[0] * d[1] > 0) k = 2;
  else if (d[0] * d[2] > 0) k = 1;
  else if (d[1] * d[2] > 0 || d[0] !== 0) k = 0;
  else if (d[1] !== 0) k = 1;
  else if (d[2] !== 0) k = 2;
  else return null;
  const i = (k + 1) % 3, j = (k + 2) % 3;
  const ti = d[i] === d[k] ? p[i] : p[i] + (p[k] - p[i]) * (d[i] / (d[i] - d[k]));
  const tj = d[j] === d[k] ? p[j] : p[j] + (p[k] - p[j]) * (d[j] / (d[j] - d[k]));
  return ti < tj ? [ti, tj] : [tj, ti];
}

/**
 * Finds intersecting triangle pairs of a mesh with a uniform grid (pairs sharing a vertex
 * are skipped). Stops after `maxPairs` hits or `budgetMs`; `complete` tells whether it
 * checked everything.
 */
export function selfIntersections(p: Float32Array, t: Uint32Array, opts: { maxPairs?: number; budgetMs?: number } = {}) {
  const maxPairs = opts.maxPairs ?? 5000;
  const budget = opts.budgetMs ?? 4000;
  const t0 = performance.now();
  const nf = t.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
  }
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const res = Math.min(128, Math.max(4, Math.round(Math.sqrt(nf / 4))));
  const cell = size / res + 1e-9;
  const dims = [maxX - minX, maxY - minY, maxZ - minZ].map((s) => Math.max(1, Math.ceil(s / cell) + 1));
  const cellOf = (x: number, k: number, lo: number) => Math.min(dims[k] - 1, Math.max(0, Math.floor((x - lo) / cell)));
  const buckets = new Map<number, number[]>();
  const box = new Float64Array(nf * 6);
  for (let f = 0; f < nf; f++) {
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = t[f * 3 + k] * 3;
      bx0 = Math.min(bx0, p[v]); bx1 = Math.max(bx1, p[v]);
      by0 = Math.min(by0, p[v + 1]); by1 = Math.max(by1, p[v + 1]);
      bz0 = Math.min(bz0, p[v + 2]); bz1 = Math.max(bz1, p[v + 2]);
    }
    box.set([bx0, by0, bz0, bx1, by1, bz1], f * 6);
    for (let z = cellOf(bz0, 2, minZ); z <= cellOf(bz1, 2, minZ); z++)
      for (let y = cellOf(by0, 1, minY); y <= cellOf(by1, 1, minY); y++)
        for (let x = cellOf(bx0, 0, minX); x <= cellOf(bx1, 0, minX); x++) {
          const key = (z * dims[1] + y) * dims[0] + x;
          const list = buckets.get(key);
          if (list) list.push(f); else buckets.set(key, [f]);
        }
  }
  const A = new Float64Array(9), B = new Float64Array(9);
  const load = (T: Float64Array, f: number) => {
    for (let k = 0; k < 3; k++) {
      const v = t[f * 3 + k] * 3;
      T[k * 3] = p[v]; T[k * 3 + 1] = p[v + 1]; T[k * 3 + 2] = p[v + 2];
    }
  };
  const seen = new Set<number>();
  const faces = new Set<number>();
  let pairs = 0, complete = true, tested = 0;
  const eps = size * 1e-9;
  outer: for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const g = list[j];
        if (box[f * 6] > box[g * 6 + 3] || box[g * 6] > box[f * 6 + 3] || box[f * 6 + 1] > box[g * 6 + 4] || box[g * 6 + 1] > box[f * 6 + 4] || box[f * 6 + 2] > box[g * 6 + 5] || box[g * 6 + 2] > box[f * 6 + 5]) continue;
        const a0 = t[f * 3], a1 = t[f * 3 + 1], a2 = t[f * 3 + 2], b0 = t[g * 3], b1 = t[g * 3 + 1], b2 = t[g * 3 + 2];
        if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) continue;
        const key = f < g ? f * nf + g : g * nf + f;
        if (seen.has(key)) continue;
        seen.add(key);
        load(A, f);
        load(B, g);
        if (trianglesIntersect(A, B, eps)) {
          faces.add(f);
          faces.add(g);
          if (++pairs >= maxPairs) { complete = false; break outer; }
        }
        if ((++tested & 4095) === 0 && performance.now() - t0 > budget) { complete = false; break outer; }
      }
    }
  }
  return { pairs, faces: [...faces], complete };
}
