import type { Topology } from '../mesh/topology';
import type { MeshData } from '../types';
import { boundaryLoops } from './region';

/**
 * Clean joint line for a region cut. A face labelling has a staircase border (it follows the
 * triangle edges). Here each border loop is smoothed as a 3D curve (Taubin: no shrinking), the
 * vertices around it get their signed distance to that curve (positive on B's side), and the
 * triangles are cut where the distance is zero. The new border runs along the smooth curve
 * through the triangles; split points are shared by both faces of an edge, so the mesh stays
 * closed.
 *
 * Returns null when there is nothing to smooth; the caller also checks that the number of loops
 * did not change.
 */
export interface SmoothedSplit {
  mesh: MeshData;
  /** 1 = face in B. */
  labels: Uint8Array;
  /** Vertices created on edges (they lie on the original surface). */
  splitVertices: number;
  /** Original edge of each created vertex: [a, b] for vertex nv + i at 2i, 2i + 1. */
  splitFrom: Uint32Array;
}

export function smoothBoundary(topo: Topology, labels: Uint8Array, opts: { rings?: number; iterations?: number } = {}): SmoothedSplit | null {
  const { nv, nf, p, t, vStart, vNbr, vFaceStart, vFaces, fArea, vNormal } = topo;
  const rings = opts.rings ?? 4, iterations = opts.iterations ?? 12;
  const loops = boundaryLoops(topo, labels);
  if (!loops.length) return null;

  // Side of each vertex in the original labelling (share of B faces around it, by area).
  const share = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    let b = 0, all = 0;
    for (let k = vFaceStart[v]; k < vFaceStart[v + 1]; k++) {
      const f = vFaces[k];
      all += fArea[f];
      if (labels[f]) b += fArea[f];
    }
    share[v] = all ? b / all : 0;
  }

  // Smoothed curves with a side direction per point (tangent × surface normal).
  const curves = loops.map((loop) => {
    const n = loop.length;
    let c = loop.map((v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
    const step = (pts: number[][], f: number) =>
      pts.map((q, i) => {
        const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
        return [0, 1, 2].map((k) => q[k] + f * ((a[k] + b[k]) / 2 - q[k]));
      });
    if (n >= 6) for (let it = 0; it < iterations; it++) c = step(step(c, 0.5), -0.53);
    const side = c.map((_, i) => {
      const a = c[(i + n - 1) % n], b = c[(i + 1) % n];
      const tg = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = loop[i];
      const nr = [vNormal[v * 3], vNormal[v * 3 + 1], vNormal[v * 3 + 2]];
      const s = [tg[1] * nr[2] - tg[2] * nr[1], tg[2] * nr[0] - tg[0] * nr[2], tg[0] * nr[1] - tg[1] * nr[0]];
      const l = Math.hypot(s[0], s[1], s[2]) || 1;
      return [s[0] / l, s[1] / l, s[2] / l];
    });
    return { pts: c, side };
  });

  // Band of vertices around the loops.
  const band = new Uint8Array(nv);
  let front: number[] = [];
  for (const l of loops)
    for (const v of l)
      if (!band[v]) {
        band[v] = 1;
        front.push(v);
      }
  for (let r = 0; r < rings; r++) {
    const next: number[] = [];
    for (const v of front)
      for (let k = vStart[v]; k < vStart[v + 1]; k++) {
        const w = vNbr[k];
        if (!band[w]) {
          band[w] = 1;
          next.push(w);
        }
      }
    front = next;
  }

  // Signed distance to the nearest smoothed curve inside the band; the original side outside.
  const BIG = 1e9;
  const d = new Float64Array(nv);
  const bandList: number[] = [];
  for (let v = 0; v < nv; v++) {
    if (band[v]) bandList.push(v);
    else d[v] = share[v] > 0.5 ? BIG : -BIG;
  }
  // Only vertices next to the curve take its side; farther ones keep the original side (the
  // sign of a distance to a curve gets noisy away from it and would make islands).
  let edge = 0, edges = 0;
  for (const l of loops)
    for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length];
      edge += Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      edges++;
    }
  const near = 1.5 * (edge / Math.max(1, edges));
  let agree = 0, disagree = 0;
  for (const v of bandList) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    let best = Infinity, sd = 0;
    for (const { pts, side } of curves) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
        const s = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / len2));
        const cx = a[0] + ab[0] * s, cy = a[1] + ab[1] * s, cz = a[2] + ab[2] * s;
        const dist = Math.hypot(x - cx, y - cy, z - cz);
        if (dist >= best) continue;
        best = dist;
        const sa = side[i], sb = side[(i + 1) % n];
        sd = (x - cx) * (sa[0] + (sb[0] - sa[0]) * s) + (y - cy) * (sa[1] + (sb[1] - sa[1]) * s) + (z - cz) * (sa[2] + (sb[2] - sa[2]) * s);
      }
    }
    d[v] = best <= near ? sd : share[v] > 0.5 ? BIG : -BIG;
    if (best > near) continue;
    // Calibrate the sign on vertices clearly on one side.
    if (share[v] === 1) sd > 0 ? agree++ : disagree++;
    else if (share[v] === 0) sd < 0 ? agree++ : disagree++;
  }
  if (disagree > agree) for (const v of bandList) if (Math.abs(d[v]) < BIG) d[v] = -d[v];
  for (const v of bandList) if (d[v] === 0) d[v] = 1e-9;

  // Snap: where the curve passes within 15% of an edge from a vertex, it goes through the
  // vertex (no near-duplicate points or slivers; the outline stays a clean polygon for the cap).
  const zero = new Uint8Array(nv);
  for (let f = 0; f < nf; f++)
    for (let j = 0; j < 3; j++) {
      const a = t[f * 3 + j], b = t[f * 3 + (j + 1) % 3];
      if (d[a] > 0 === d[b] > 0) continue;
      const s = d[a] / (d[a] - d[b]);
      if (s < 0.15) zero[a] = 1;
      else if (s > 0.85) zero[b] = 1;
    }
  const sign = (v: number) => (zero[v] ? 0 : d[v] > 0 ? 1 : -1);

  // Cut the triangles crossing the zero set.
  const pos: number[] = Array.from(p);
  const tris: number[] = [];
  const out: number[] = [];
  const splitAt = new Map<number, number>();
  const from: number[] = [];
  const split = (a: number, b: number) => {
    const key = a < b ? a * nv + b : b * nv + a;
    let id = splitAt.get(key);
    if (id !== undefined) return id;
    const s = d[a] / (d[a] - d[b]);
    id = pos.length / 3;
    for (let k = 0; k < 3; k++) pos.push(p[a * 3 + k] + (p[b * 3 + k] - p[a * 3 + k]) * s);
    splitAt.set(key, id);
    from.push(a, b);
    return id;
  };
  const push = (a: number, b: number, c: number, side: number) => {
    tris.push(a, b, c);
    out.push(side);
  };
  for (let f = 0; f < nf; f++) {
    const v = [t[f * 3], t[f * 3 + 1], t[f * 3 + 2]];
    const s = v.map(sign);
    const pos_ = s.some((x) => x > 0), neg = s.some((x) => x < 0);
    if (!(pos_ && neg)) {
      // One side only (vertices on the curve just touch it); all on the curve: keep the label.
      push(v[0], v[1], v[2], pos_ ? 1 : neg ? 0 : labels[f]);
      continue;
    }
    const z = s.indexOf(0);
    if (z >= 0) {
      // Curve through one vertex and across the opposite edge.
      const P = v[(z + 1) % 3], Q = v[(z + 2) % 3];
      const m = split(P, Q);
      push(v[z], P, m, s[(z + 1) % 3] > 0 ? 1 : 0);
      push(v[z], m, Q, s[(z + 2) % 3] > 0 ? 1 : 0);
      continue;
    }
    // The vertex alone on its side, then the other two in order (keeps the winding).
    const lone = s[0] !== s[1] && s[0] !== s[2] ? 0 : s[1] !== s[0] && s[1] !== s[2] ? 1 : 2;
    const L = v[lone], P = v[(lone + 1) % 3], Q = v[(lone + 2) % 3];
    const side = s[lone] > 0 ? 1 : 0;
    const m1 = split(L, P), m2 = split(L, Q);
    push(L, m1, m2, side);
    push(m1, P, Q, 1 - side);
    push(m1, Q, m2, 1 - side);
  }
  return { mesh: { positions: Float32Array.from(pos), indices: Uint32Array.from(tris) }, labels: Uint8Array.from(out), splitVertices: splitAt.size, splitFrom: Uint32Array.from(from) };
}
