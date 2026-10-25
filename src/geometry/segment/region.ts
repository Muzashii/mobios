import { MeshQuery } from '../mesh/bvh';
import { buildTopology, DisjointSet, edgeFold, geodesic, MinHeap, type Topology } from '../mesh/topology';
import type { MeshData, Plane, RegionBall, RegionKind, Vec3 } from '../types';
import { FlowGraph } from './mincut';

/**
 * SmartCut v2 — region analysis on one mesh.
 *
 * 1. Seed region R: each brush dab becomes the ball inscribed in the limb under it (Shape
 *    Diameter Function, BVH ray cone). R is flood-filled inside each ball from the dab, so a
 *    ball never grabs a hand that merely touches the head.
 * 2. Geodesic distance d from R. At each level t the surface {d ≥ t} splits into components;
 *    the largest is the body (A) and everything else is B, so B always contains the seeds.
 * 3. Levels are scored (narrow + concave rings win, the "minima rule") → top candidates.
 * 4. Each candidate's ring is snapped by a min-cut on the dual graph inside a band around it:
 *    crossing concave creases and seams is cheap, so the boundary follows necks and hems.
 * 5. Face labels → ordered boundary loops (one per hole/handle).
 */
export interface RegionContext {
  mesh: MeshData;
  topo: Topology;
  query: MeshQuery;
  diag: number;
  /** Mean edge length (mm). */
  edge: number;
  /** Per-vertex concavity in [0, ∞) (neighbours above the tangent plane). */
  concavity: Float32Array;
  grid: VertexGrid;
  /** Vertices on feature lines (sharp fold: seams, hems, hairline steps, junctions). */
  creases: Uint8Array;
  creaseCount: number;
}

/** Fold (radians) above which an edge counts as a feature line. */
const CREASE = 0.6;
/** Extra geodesic cost for walking along/over a feature edge: rings stick to seams. */
const CREASE_COST = 3;

export function makeContext(mesh: MeshData): RegionContext {
  const topo = buildTopology(mesh);
  const { p, nv, vStart, vNbr, vNormal: vn } = topo;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  let edgeSum = 0, edgeCount = 0;
  const concavity = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    let s = 0, n = 0;
    for (let k = vStart[v]; k < vStart[v + 1]; k++) {
      const w = vNbr[k];
      const dx = p[w * 3] - p[v * 3], dy = p[w * 3 + 1] - p[v * 3 + 1], dz = p[w * 3 + 2] - p[v * 3 + 2];
      const d = Math.hypot(dx, dy, dz) || 1;
      edgeSum += d;
      edgeCount++;
      s += (dx * vn[v * 3] + dy * vn[v * 3 + 1] + dz * vn[v * 3 + 2]) / d;
      n++;
    }
    concavity[v] = n ? Math.max(0, s / n) : 0;
  }
  const creases = featureVertices(topo);
  return {
    mesh,
    topo,
    query: new MeshQuery(mesh),
    diag,
    edge: edgeCount ? edgeSum / edgeCount : diag / 100,
    concavity,
    grid: new VertexGrid(p, [minX, minY, minZ], [maxX, maxY, maxZ]),
    creases,
    creaseCount: creases.reduce((a, b) => a + b, 0),
  };
}

function featureVertices(topo: Topology): Uint8Array {
  const out = new Uint8Array(topo.nv);
  for (let f = 0; f < topo.nf; f++) for (let k = 0; k < 3; k++) {
    if (Math.abs(edgeFold(topo, f, k)) < CREASE) continue;
    out[topo.t[f * 3 + k]] = 1;
    out[topo.t[f * 3 + (k + 1) % 3]] = 1;
  }
  return out;
}

/** Uniform hash grid over the vertices (ball membership without O(vertices × seeds)). */
export class VertexGrid {
  private cell: number;
  private dims: [number, number, number];
  private start: Uint32Array;
  private items: Uint32Array;
  constructor(private p: Float32Array, private min: Vec3, max: Vec3) {
    const nv = p.length / 3;
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    // ~8 vertices per occupied cell on a surface (cells ∝ N²), capped for memory.
    const cells = Math.min(160, Math.max(1, Math.round(Math.sqrt(nv / 8))));
    this.cell = Math.max(Math.max(...size) / cells, 1e-6);
    this.dims = size.map((s) => Math.max(1, Math.ceil(s / this.cell) + 1)) as [number, number, number];
    const n = this.dims[0] * this.dims[1] * this.dims[2];
    const counts = new Uint32Array(n + 1);
    const ids = new Uint32Array(nv);
    for (let v = 0; v < nv; v++) {
      ids[v] = this.index(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      counts[ids[v] + 1]++;
    }
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    const fill = counts.slice(0, n);
    this.items = new Uint32Array(nv);
    for (let v = 0; v < nv; v++) this.items[fill[ids[v]]++] = v;
    this.start = counts;
  }
  private coord(x: number, k: number) {
    return Math.min(this.dims[k] - 1, Math.max(0, Math.floor((x - this.min[k]) / this.cell)));
  }
  private index(x: number, y: number, z: number) {
    return (this.coord(z, 2) * this.dims[1] + this.coord(y, 1)) * this.dims[0] + this.coord(x, 0);
  }
  /** Calls `cb` for every vertex within `r` of `c`. */
  within(c: Vec3, r: number, cb: (v: number) => void) {
    const r2 = r * r, p = this.p;
    const lo = [0, 1, 2].map((k) => this.coord(c[k] - r, k));
    const hi = [0, 1, 2].map((k) => this.coord(c[k] + r, k));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const i = (z * this.dims[1] + y) * this.dims[0] + x;
      for (let k = this.start[i]; k < this.start[i + 1]; k++) {
        const v = this.items[k];
        if ((p[v * 3] - c[0]) ** 2 + (p[v * 3 + 1] - c[1]) ** 2 + (p[v * 3 + 2] - c[2]) ** 2 <= r2) cb(v);
      }
    }
  }
  /** Nearest vertex to `c` (expanding search). */
  nearest(c: Vec3): number {
    let best = -1, bd = Infinity;
    // Every vertex within r is visited, so the first hit set already holds the nearest.
    const span = this.cell * Math.max(...this.dims) * 4 + 1;
    for (let r = this.cell; best < 0 && r < span; r *= 2) {
      this.within(c, r, (v) => {
        const d = (this.p[v * 3] - c[0]) ** 2 + (this.p[v * 3 + 1] - c[1]) ** 2 + (this.p[v * 3 + 2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = v; }
      });
    }
    return best;
  }
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const crossV = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Groups brush dabs that belong together (single linkage); far-apart dabs → separate cuts. */
export function clusterSeeds(seeds: Vec3[], radius: number): Vec3[][] {
  const link = Math.max(radius * 3, 1e-6);
  const ds = new DisjointSet(seeds.length);
  seeds.forEach((_, i) => ds.add(i));
  for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) {
    if (Math.hypot(seeds[i][0] - seeds[j][0], seeds[i][1] - seeds[j][1], seeds[i][2] - seeds[j][2]) <= link) {
      const a = ds.find(i), b = ds.find(j);
      if (a !== b) ds.parent[b] = a;
    }
  }
  const groups = new Map<number, Vec3[]>();
  seeds.forEach((s, i) => {
    const r = ds.find(i);
    const g = groups.get(r);
    if (g) g.push(s); else groups.set(r, [s]);
  });
  return [...groups.values()];
}

/** Inflation of the inscribed ball so it reaches around the limb (projected lengths run short). */
const RADIUS_GAIN = 1.25;
/** Minimum cos(normal, direction from the ball centre) for a vertex to join the seed region. */
const FACING = 0.4;

/**
 * Shape Diameter Function per dab: median length of a cone of rays shot inwards. Each dab
 * becomes the ball inscribed in the part there (anchored at the dab, `s`).
 */
export function seedBalls(ctx: RegionContext, seeds: Vec3[], brushRadius: number, gain = RADIUS_GAIN): RegionBall[] {
  const { query, topo, diag } = ctx;
  const step = Math.max(1, Math.ceil(seeds.length / 24));
  const balls: RegionBall[] = seeds.map((s) => ({ c: s, r: brushRadius, s }));
  const cone = (25 * Math.PI) / 180;
  for (let i = 0; i < seeds.length; i += step) {
    const s = seeds[i];
    const hit = query.closest(s);
    if (!hit || hit.face < 0) continue;
    const f = hit.face;
    const n: Vec3 = [topo.fNormal[f * 3], topo.fNormal[f * 3 + 1], topo.fNormal[f * 3 + 2]];
    const inward: Vec3 = [-n[0], -n[1], -n[2]];
    const helper: Vec3 = Math.abs(inward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const a = norm(crossV(inward, helper));
    const b = norm(crossV(inward, a));
    // Start just inside the surface: the first crossing is the opposite wall.
    const eps = Math.max(ctx.edge * 1e-3, 1e-4);
    const o: Vec3 = [hit.point[0] - n[0] * eps, hit.point[1] - n[1] * eps, hit.point[2] - n[2] * eps];
    const lengths: number[] = [];
    let axis = 0;
    // Axis + one ring at 25°: a wider or denser cone
    // lets rays slip down a neck into the body (the head of a figure is not 60 mm thick).
    const dirs: Vec3[] = [inward];
    const tn = Math.tan(cone);
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      dirs.push(norm([0, 1, 2].map((j) => inward[j] + tn * (Math.cos(ang) * a[j] + Math.sin(ang) * b[j])) as Vec3));
    }
    // Skip the first fraction of an edge: on a noisy scan the ray would otherwise hit the
    // surface's own roughness right next to the dab.
    const near = Math.max(eps * 4, ctx.edge * 0.3);
    for (const d of dirs) {
      const h = query.first(o, d, near);
      if (!h) continue;
      const cos = d[0] * inward[0] + d[1] * inward[1] + d[2] * inward[2];
      if (d === inward) axis = h.distance;
      // chord / cos θ is exactly the diameter of a sphere (head, hand) and ~10% over for a
      // cylinder brushed from the side; the median ignores rays that slip down a neck.
      lengths.push(h.distance / cos);
    }
    if (!lengths.length) continue;
    lengths.sort((x, y) => x - y);
    // Outlier-robust: median of the cone.
    const diameter = lengths[Math.floor(lengths.length / 2)];
    if (!(diameter > 0)) continue;
    const depth = Math.min(axis || diameter, diameter) / 2;
    const r = Math.min(Math.max(brushRadius, (diameter / 2) * gain), diag * 0.25);
    balls.push({ c: [hit.point[0] - n[0] * depth, hit.point[1] - n[1] * depth, hit.point[2] - n[2] * depth], r, s });
  }
  return balls;
}

/** Vertices of the seed region: flood fill from each ball's dab, staying inside the ball. */
export function regionVertices(ctx: RegionContext, balls: RegionBall[]): Uint8Array {
  const { topo, grid } = ctx;
  const { p, vStart, vNbr } = topo;
  const inR = new Uint8Array(topo.nv);
  // Per-ball visit stamp: a vertex already in R (from another ball) must still be traversed.
  const stamp = new Int32Array(topo.nv).fill(-1);
  balls.forEach((b, bi) => {
    const startV = grid.nearest(b.s ?? b.c);
    if (startV < 0) return;
    inR[startV] = 1;
    stamp[startV] = bi;
    const stack = [startV];
    const r2 = b.r * b.r;
    // Inscribed balls (centre inside the part) also require the surface to face away from the
    // centre: true all around a head or a limb, false on the shoulder/torso right past the
    // junction, which a pure distance test would swallow.
    const inscribed = !!b.s && Math.hypot(b.s[0] - b.c[0], b.s[1] - b.c[1], b.s[2] - b.c[2]) > 1e-6;
    const vn = topo.vNormal;
    while (stack.length) {
      const v = stack.pop()!;
      // Feature lines (hem, hairline, a junction) bound the region: it grows up to them, not past.
      if (v !== startV && ctx.creases[v]) continue;
      for (let k = vStart[v]; k < vStart[v + 1]; k++) {
        const w = vNbr[k];
        if (stamp[w] === bi) continue;
        const dx = p[w * 3] - b.c[0], dy = p[w * 3 + 1] - b.c[1], dz = p[w * 3 + 2] - b.c[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        if (inscribed && (dx * vn[w * 3] + dy * vn[w * 3 + 1] + dz * vn[w * 3 + 2]) < FACING * Math.sqrt(d2)) continue;
        stamp[w] = bi;
        inR[w] = 1;
        stack.push(w);
      }
    }
  });
  return inR;
}

export interface Field {
  d: Float64Array;
  maxD: number;
  /** Area-weighted centroid of R (B side). */
  centroid: Vec3;
  seedVerts: number[];
  negVerts: number[];
}

export function regionField(ctx: RegionContext, balls: RegionBall[], seeds: Vec3[], negSeeds: Vec3[] = []): Field {
  // A ball never reaches a negative seed: "keep this with the body" wins over the SDF guess.
  if (negSeeds.length) {
    balls = balls.map((b) => {
      let r = b.r;
      for (const n of negSeeds) r = Math.min(r, Math.hypot(n[0] - b.c[0], n[1] - b.c[1], n[2] - b.c[2]) * 0.85);
      return r === b.r ? b : { ...b, r };
    });
  }
  const inR = regionVertices(ctx, balls);
  const src: number[] = [];
  const c: Vec3 = [0, 0, 0];
  const p = ctx.topo.p;
  for (let v = 0; v < ctx.topo.nv; v++) if (inR[v]) {
    src.push(v);
    c[0] += p[v * 3]; c[1] += p[v * 3 + 1]; c[2] += p[v * 3 + 2];
  }
  if (!src.length) throw new Error('Pincele ou clique na região que quer separar.');
  // Crossing a feature line costs extra: iso-rings pile up on hems and hairlines.
  const cv = ctx.creases, k = CREASE_COST;
  const d = ctx.creaseCount && k > 0 ? geodesic(ctx.topo, src, (a, b, len) => (cv[a] || cv[b] ? len * (1 + k) : len)) : geodesic(ctx.topo, src);
  let maxD = 0;
  for (let v = 0; v < d.length; v++) if (Number.isFinite(d[v]) && d[v] > maxD) maxD = d[v];
  const nearest = (s: Vec3) => ctx.grid.nearest(s);
  return {
    d,
    maxD,
    centroid: [c[0] / src.length, c[1] / src.length, c[2] / src.length],
    seedVerts: seeds.map(nearest).filter((v) => v >= 0),
    negVerts: negSeeds.map(nearest).filter((v) => v >= 0),
  };
}

export interface LevelScore {
  t: number;
  perimeter: number;
  concavity: number;
  score: number;
}

/**
 * Sweeps iso-levels from far to near with an incremental union-find and scores the ring
 * that bounds the body at each level. Returns the best levels (distinct local minima).
 */
export function scanLevels(ctx: RegionContext, field: Field, maxCandidates = 3): LevelScore[] {
  const { topo, concavity } = ctx;
  const { nv, nf, t, p, vStart, vNbr, vArea } = topo;
  const { d, maxD, negVerts } = field;
  if (maxD <= 0) throw new Error('A região pincelada cobre a peça inteira.');
  // Finer levels on big parts: about one level per 1.5 edges, between 72 and 220.
  const levels = Math.round(Math.min(220, Math.max(72, maxD / (ctx.edge * 1.5))));
  const order = Array.from({ length: nv }, (_, i) => i).filter((v) => Number.isFinite(d[v])).sort((a, b) => d[b] - d[a]);
  const ds = new DisjointSet(nv);
  const compArea = new Float64Array(nv);
  const creaseness = (c: number) => Math.min(2, Math.max(0, c - 0.02) / 0.25);
  // Separate shells the seeds cannot reach never count as body area.
  let reachable = 0;
  for (const v of order) reachable += vArea[v];

  interface Level { t: number; perimeter: number; concavity: number; valid: boolean; areaB: number }
  const results: Level[] = [];
  let oi = 0, bigRoot = -1, bigArea = 0;
  for (let k = levels - 1; k >= 1; k--) {
    const lt = (maxD * k) / levels;
    while (oi < order.length && d[order[oi]] >= lt) {
      const v = order[oi++];
      ds.add(v);
      compArea[v] = vArea[v];
      let root = v;
      for (let j = vStart[v]; j < vStart[v + 1]; j++) {
        const w = vNbr[j];
        if (!ds.has(w)) continue;
        const rv = ds.find(root), rw = ds.find(w);
        if (rv !== rw) {
          ds.parent[rw] = rv;
          compArea[rv] += compArea[rw];
          root = rv;
        }
      }
      const r = ds.find(v);
      if (compArea[r] > bigArea || (bigRoot >= 0 && ds.find(bigRoot) === r)) {
        bigRoot = r;
        bigArea = compArea[r];
      }
    }
    if (bigRoot >= 0) bigRoot = ds.find(bigRoot);
    let valid = bigRoot >= 0 && bigArea > reachable * 0.5;
    // Negative seeds (Shift + brush) must stay with the body.
    if (valid) for (const nvx of negVerts) if (!ds.has(nvx) || ds.find(nvx) !== bigRoot) { valid = false; break; }
    let perimeter = 0, conc = 0;
    if (valid) {
      for (let f = 0; f < nf; f++) {
        const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2];
        const ua = d[a] >= lt, ub = d[b] >= lt, uc = d[c] >= lt;
        const nUp = +ua + +ub + +uc;
        if (nUp === 0 || nUp === 3) continue;
        const upV = ua ? a : ub ? b : c;
        if (ds.find(upV) !== bigRoot) continue;
        const pts: number[] = [];
        let cs = 0;
        const vs = [a, b, c], up = [ua, ub, uc];
        for (let e = 0; e < 3; e++) {
          if (up[e] === up[(e + 1) % 3]) continue;
          const x = vs[e], y = vs[(e + 1) % 3];
          const s = (lt - d[x]) / (d[y] - d[x]);
          pts.push(p[x * 3] + (p[y * 3] - p[x * 3]) * s, p[x * 3 + 1] + (p[y * 3 + 1] - p[x * 3 + 1]) * s, p[x * 3 + 2] + (p[y * 3 + 2] - p[x * 3 + 2]) * s);
          cs += concavity[x] + (concavity[y] - concavity[x]) * s;
        }
        if (pts.length !== 6) continue;
        const len = Math.hypot(pts[3] - pts[0], pts[4] - pts[1], pts[5] - pts[2]);
        perimeter += len;
        conc += (cs / 2) * len;
      }
    }
    results.push({ t: lt, perimeter, concavity: perimeter ? creaseness(conc / perimeter) : 0, valid, areaB: reachable - bigArea });
  }

  const valid = results.filter((r) => r.valid && r.perimeter > 0).reverse(); // near → far
  if (valid.length === 0) throw new Error('Não encontrei uma articulação. Pincele a região que quer separar (ex.: o braço inteiro).');
  const sortedL = valid.map((r) => r.perimeter).sort((a, b) => a - b);
  const lMed = sortedL[Math.floor(sortedL.length / 2)];
  const tMax = valid[valid.length - 1].t;
  // Around a click the rings first grow like a disc (≈ 2π mm of perimeter per mm) before
  // wrapping around the limb. Candidates start where the perimeter stops growing fast or at
  // a crease.
  // A ring that already closes the region off (P² ≪ 4π·area, unlike a growing disc where
  // P² ≈ 4π·area) is a candidate right away: the seed region wraps the head or the limb.
  let start = valid.length - 1;
  for (let i = 0; i < valid.length; i++) {
    if (valid[i].concavity >= 0.35) { start = i; break; }
    if (valid[i].perimeter ** 2 < 5 * valid[i].areaB) { start = i; break; }
    const next = valid[i + 1];
    if (next && (next.perimeter - valid[i].perimeter) / (next.t - valid[i].t) < 1) { start = i; break; }
  }
  const scored = valid.slice(start).map((r) => ({ ...r, score: r.perimeter / lMed - 0.6 * Math.min(1.5, r.concavity) + 0.3 * (r.t / tMax) }));
  // Distinct local minima, best first.
  const minima = scored.filter((r, i) => (i === 0 || r.score <= scored[i - 1].score) && (i === scored.length - 1 || r.score <= scored[i + 1].score));
  minima.sort((a, b) => a.score - b.score);
  // Near-ties go to the ring closest to the click: whoever clicks the hand wants the hand,
  // not the whole arm behind a slightly sharper shoulder crease.
  if (minima.length > 1) {
    const near = minima.filter((m) => m.score <= minima[0].score + 0.15).sort((a, b) => a.t - b.t)[0];
    minima.splice(minima.indexOf(near), 1);
    minima.unshift(near);
  }
  const out: LevelScore[] = [];
  const gap = maxD / levels * 3;
  for (const m of minima) {
    if (out.some((o) => Math.abs(o.t - m.t) < gap)) continue;
    out.push({ t: m.t, perimeter: m.perimeter, concavity: m.concavity, score: m.score });
    if (out.length >= maxCandidates) break;
  }
  if (!out.length) out.push({ ...scored[0] });
  return out;
}

/** Vertex side at level t: 1 = B (seed side), 0 = A (largest component of {d ≥ t}). */
export function sideAtLevel(ctx: RegionContext, field: Field, level: number): Uint8Array {
  const { nv, vStart, vNbr, vArea } = ctx.topo;
  const { d } = field;
  const ds = new DisjointSet(nv);
  const area = new Float64Array(nv);
  for (let v = 0; v < nv; v++) if (d[v] >= level && Number.isFinite(d[v])) { ds.add(v); area[v] = vArea[v]; }
  for (let v = 0; v < nv; v++) {
    if (!ds.has(v)) continue;
    for (let k = vStart[v]; k < vStart[v + 1]; k++) {
      const w = vNbr[k];
      if (w < v || !ds.has(w)) continue;
      const a = ds.find(v), b = ds.find(w);
      if (a !== b) { ds.parent[b] = a; area[a] += area[b]; }
    }
  }
  let big = -1, bigA = 0;
  for (let v = 0; v < nv; v++) if (ds.has(v) && ds.parent[v] === v && area[v] > bigA) { bigA = area[v]; big = v; }
  const side = new Uint8Array(nv).fill(1);
  for (let v = 0; v < nv; v++) {
    // Unreachable vertices (other shells of the same part) always stay in A.
    if (!Number.isFinite(d[v]) || (big >= 0 && ds.has(v) && ds.find(v) === big)) side[v] = 0;
  }
  return side;
}

/** Dual-edge cost: cheap across concave creases (necks) and, less, sharp ridges (hems, seams). */
export function edgeCost(topo: Topology, f: number, k: number) {
  const { p, t } = topo;
  const a = t[f * 3 + k], b = t[f * 3 + (k + 1) % 3];
  const len = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  const fold = edgeFold(topo, f, k);
  const conc = Math.max(0, fold), conv = Math.max(0, -fold);
  return len * (0.06 + 0.94 * Math.exp(-((conc / 0.35) ** 2))) * (0.35 + 0.65 * Math.exp(-((conv / 0.6) ** 2)));
}

/**
 * Face labels (1 = B) at a level, snapped by min-cut inside a band of ±`band` mm around it.
 * Labels are cleaned so B is the component(s) holding the seeds and A is one connected body.
 */
export function labelFaces(ctx: RegionContext, field: Field, level: number, band: number): Uint8Array {
  const { topo } = ctx;
  const { nf, t, faceNbr } = topo;
  const side = sideAtLevel(ctx, field, level);
  const labels = new Uint8Array(nf);
  const fd = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2];
    labels[f] = side[a] + side[b] + side[c] >= 2 ? 1 : 0;
    fd[f] = (field.d[a] + field.d[b] + field.d[c]) / 3;
  }
  if (band > 0) {
    // Band faces: near the level, plus every face whose label disagrees with a neighbour's.
    const idx = new Int32Array(nf).fill(-1);
    const nodes: number[] = [];
    // The band never reaches into the seed region itself (it stays B and feeds the source):
    // otherwise the cheapest cut is a tiny loop around the clicked point.
    const lo = Math.max(level - band, level * 0.5);
    for (let f = 0; f < nf; f++) {
      if (fd[f] >= lo && fd[f] <= level + band) { idx[f] = nodes.length; nodes.push(f); }
    }
    if (nodes.length > 0 && nodes.length < nf) {
      const S = nodes.length, T = nodes.length + 1;
      const g = new FlowGraph(nodes.length + 2);
      const INF = 1e18;
      for (const f of nodes) {
        const u = idx[f];
        for (let k = 0; k < 3; k++) {
          const h = faceNbr[f * 3 + k];
          if (h < 0) continue;
          const c = edgeCost(topo, f, k);
          if (idx[h] >= 0) {
            if (h > f) g.addEdge(u, idx[h], c);
          } else if (labels[h]) g.addEdge(S, u, c, 0);
          else g.addEdge(u, T, c, 0);
        }
      }
      // Seeds and negative seeds pin their faces.
      for (const v of field.seedVerts) for (const f of Array.from(facesOf(topo, v))) if (idx[f] >= 0) g.addEdge(S, idx[f], INF, 0);
      for (const v of field.negVerts) for (const f of Array.from(facesOf(topo, v))) if (idx[f] >= 0) g.addEdge(idx[f], T, INF, 0);
      g.maxflow(S, T);
      const reach = g.sourceSide(S);
      for (const f of nodes) labels[f] = reach[idx[f]] ? 1 : 0;
    }
  }
  cleanLabels(topo, labels, field);
  for (let it = 0; it < 6 && fixPinches(topo, labels); it++) cleanLabels(topo, labels, field);
  return labels;
}

/**
 * Moves a rough border (e.g. carried from the part map) onto the cheapest closed line nearby:
 * min cut inside a band of ±`band` mm along the surface around it, where crossing a concave
 * crease costs little (neck, armpit, under a brim). Faces deeper than the band keep their side.
 */
export function snapToCreases(topo: Topology, labels: Uint8Array, band: number): Uint8Array {
  const { nf, faceNbr, p, t } = topo;
  const cen = (f: number, k: number) => (p[t[f * 3] * 3 + k] + p[t[f * 3 + 1] * 3 + k] + p[t[f * 3 + 2] * 3 + k]) / 3;
  // Surface distance from the border (face to face).
  const d = new Float64Array(nf).fill(Infinity);
  const heap = new MinHeap(1024);
  for (let f = 0; f < nf; f++)
    for (let k = 0; k < 3; k++) {
      const g = faceNbr[f * 3 + k];
      if (g >= 0 && labels[g] !== labels[f]) {
        d[f] = 0;
        heap.push(f, 0);
        break;
      }
    }
  while (heap.size) {
    const key = heap.topKey();
    const f = heap.pop();
    if (key > d[f] || key > band) continue;
    for (let k = 0; k < 3; k++) {
      const g = faceNbr[f * 3 + k];
      if (g < 0) continue;
      const nd = key + Math.hypot(cen(f, 0) - cen(g, 0), cen(f, 1) - cen(g, 1), cen(f, 2) - cen(g, 2));
      if (nd < d[g]) {
        d[g] = nd;
        heap.push(g, nd);
      }
    }
  }
  const idx = new Int32Array(nf).fill(-1);
  const nodes: number[] = [];
  for (let f = 0; f < nf; f++) if (d[f] <= band) { idx[f] = nodes.length; nodes.push(f); }
  const out = Uint8Array.from(labels);
  if (!nodes.length) return out;
  const S = nodes.length, T = nodes.length + 1;
  const g = new FlowGraph(nodes.length + 2);
  for (const f of nodes) {
    const u = idx[f];
    for (let k = 0; k < 3; k++) {
      const h = faceNbr[f * 3 + k];
      if (h < 0) continue;
      const c = edgeCost(topo, f, k);
      if (idx[h] >= 0) {
        if (h > f) g.addEdge(u, idx[h], c);
      } else if (labels[h]) g.addEdge(S, u, c, 0);
      else g.addEdge(u, T, c, 0);
    }
  }
  g.maxflow(S, T);
  const reach = g.sourceSide(S);
  for (const f of nodes) out[f] = reach[idx[f]] ? 1 : 0;
  return out;
}

/**
 * A boundary that touches itself at a vertex (two B fans meeting at one point) has no single
 * loop through it. Grow B over the faces around each such vertex; returns true if it changed.
 */
export function fixPinches(topo: Topology, labels: Uint8Array): boolean {
  const { nv, nf, t, faceNbr } = topo;
  const out = new Uint8Array(nv);
  const pinched: number[] = [];
  for (let f = 0; f < nf; f++) {
    if (!labels[f]) continue;
    for (let k = 0; k < 3; k++) {
      const g = faceNbr[f * 3 + k];
      if (g < 0 || labels[g]) continue;
      const a = t[f * 3 + k];
      if (++out[a] === 2) pinched.push(a);
    }
  }
  for (const v of pinched) for (let i = topo.vFaceStart[v]; i < topo.vFaceStart[v + 1]; i++) labels[topo.vFaces[i]] = 1;
  return pinched.length > 0;
}

function facesOf(topo: Topology, v: number): ArrayLike<number> {
  return topo.vFaces.subarray(topo.vFaceStart[v], topo.vFaceStart[v + 1]);
}

/** Connected components of faces with the same label (dual graph). */
function components(topo: Topology, labels: Uint8Array, value: number): Int32Array {
  const comp = new Int32Array(topo.nf).fill(-1);
  let id = 0;
  for (let f0 = 0; f0 < topo.nf; f0++) {
    if (labels[f0] !== value || comp[f0] >= 0) continue;
    const stack = [f0];
    comp[f0] = id;
    while (stack.length) {
      const f = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const g = topo.faceNbr[f * 3 + k];
        if (g >= 0 && labels[g] === value && comp[g] < 0) { comp[g] = id; stack.push(g); }
      }
    }
    id++;
  }
  return comp;
}

/**
 * Keeps the largest A component as the body; other A islands enclosed by B join B (they are
 * holes inside the selected region). Separate shells that never touch B stay in A.
 * B islands without any seed go back to A (e.g. a min-cut sliver in the band).
 */
function cleanLabels(topo: Topology, labels: Uint8Array, field: Field) {
  const touchesOther = (comp: Int32Array, value: number) => {
    const out = new Set<number>();
    for (let f = 0; f < topo.nf; f++) {
      if (comp[f] < 0) continue;
      for (let k = 0; k < 3; k++) {
        const g = topo.faceNbr[f * 3 + k];
        if (g >= 0 && labels[g] !== value) { out.add(comp[f]); break; }
      }
    }
    return out;
  };
  const areaOf = (comp: Int32Array) => {
    const area = new Map<number, number>();
    for (let f = 0; f < topo.nf; f++) if (comp[f] >= 0) area.set(comp[f], (area.get(comp[f]) ?? 0) + topo.fArea[f]);
    return area;
  };
  const compA = components(topo, labels, 0);
  const areaA = areaOf(compA);
  let body = -1, best = -1;
  for (const [c, a] of areaA) if (a > best) { best = a; body = c; }
  const enclosed = touchesOther(compA, 0);
  for (let f = 0; f < topo.nf; f++) if (compA[f] >= 0 && compA[f] !== body && enclosed.has(compA[f])) labels[f] = 1;

  const compB = components(topo, labels, 1);
  const seeded = new Set<number>();
  for (const v of field.seedVerts) for (const f of Array.from(facesOf(topo, v))) if (compB[f] >= 0) seeded.add(compB[f]);
  if (seeded.size) {
    const areaB = areaOf(compB);
    for (let f = 0; f < topo.nf; f++) if (compB[f] >= 0 && !seeded.has(compB[f]) && (areaB.get(compB[f]) ?? 0) < topo.totalArea * 0.02) labels[f] = 0;
  }
}

/**
 * Ordered boundary loops of the B region, following B's winding (a → b on B faces whose
 * neighbour is A). Returns vertex indices; throws on pinched (non-manifold) boundaries.
 */
export function boundaryLoops(topo: Topology, labels: Uint8Array): number[][] {
  const { nf, t, faceNbr } = topo;
  const next = new Map<number, number>();
  for (let f = 0; f < nf; f++) {
    if (!labels[f]) continue;
    for (let k = 0; k < 3; k++) {
      const g = faceNbr[f * 3 + k];
      if (g < 0 || labels[g]) continue;
      const a = t[f * 3 + k], b = t[f * 3 + (k + 1) % 3];
      if (next.has(a)) throw new LoopError('O contorno da região se toca num ponto (vértice compartilhado).');
      next.set(a, b);
    }
  }
  const loops: number[][] = [];
  while (next.size) {
    const start = next.keys().next().value as number;
    const loop: number[] = [];
    let cur = start;
    for (;;) {
      const nx = next.get(cur);
      if (nx === undefined) throw new LoopError('Contorno da região aberto.');
      loop.push(cur);
      next.delete(cur);
      cur = nx;
      if (cur === start) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export class LoopError extends Error {}

/** PCA plane of a polyline (normal = least spread), weighted by segment length. */
export function fitPlane(points: Vec3[], towards: Vec3): { plane: Plane; radius: number; planarity: number } {
  const c: Vec3 = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const w = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-9;
    for (let k = 0; k < 3; k++) c[k] += ((a[k] + b[k]) / 2) * w;
    wsum += w;
  }
  for (let k = 0; k < 3; k++) c[k] /= wsum;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const q of points) {
    const x = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += x[i] * x[j];
  }
  let normal = smallestEigenvector(cov);
  const to = [towards[0] - c[0], towards[1] - c[1], towards[2] - c[2]];
  if (normal[0] * to[0] + normal[1] * to[1] + normal[2] * to[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];
  let radius = 0, off = 0;
  for (const q of points) {
    const x: Vec3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    radius = Math.max(radius, Math.hypot(...x));
    off = Math.max(off, Math.abs(x[0] * normal[0] + x[1] * normal[1] + x[2] * normal[2]));
  }
  return { plane: { origin: c, normal }, radius, planarity: radius > 0 ? off / radius : 0 };
}

/** Kind of region from its boundary: creased (seam/hem) or a limb neck. */
export function regionKind(topo: Topology, labels: Uint8Array): RegionKind {
  let len = 0, creased = 0;
  const { nf, t, faceNbr, p } = topo;
  for (let f = 0; f < nf; f++) {
    if (!labels[f]) continue;
    for (let k = 0; k < 3; k++) {
      const g = faceNbr[f * 3 + k];
      if (g < 0 || labels[g]) continue;
      const a = t[f * 3 + k], b = t[f * 3 + (k + 1) % 3];
      const l = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      len += l;
      if (Math.abs(edgeFold(topo, f, k)) > 0.45) creased += l;
    }
  }
  return len > 0 && creased / len > 0.5 ? 'crease' : 'limb';
}

/** Eigenvector of the smallest eigenvalue of a symmetric 3×3 matrix (Jacobi). */
export function smallestEigenvector(m: number[]): Vec3 {
  const a = [...m];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) off += a[i * 3 + j] ** 2;
    if (off < 1e-18) break;
    for (const [pI, qI] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[pI * 3 + qI];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[qI * 3 + qI] - a[pI * 3 + pI]) / (2 * apq);
      const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(tt * tt + 1), sn = tt * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + pI], akq = a[k * 3 + qI];
        a[k * 3 + pI] = cs * akp - sn * akq;
        a[k * 3 + qI] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[pI * 3 + k], aqk = a[qI * 3 + k];
        a[pI * 3 + k] = cs * apk - sn * aqk;
        a[qI * 3 + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + pI], vkq = v[k * 3 + qI];
        v[k * 3 + pI] = cs * vkp - sn * vkq;
        v[k * 3 + qI] = sn * vkp + cs * vkq;
      }
    }
  }
  let idx = 0;
  for (let i = 1; i < 3; i++) if (a[i * 4] < a[idx * 4]) idx = i;
  const e: Vec3 = [v[idx], v[3 + idx], v[6 + idx]];
  const l = Math.hypot(...e) || 1;
  return [e[0] / l, e[1] / l, e[2] / l];
}
