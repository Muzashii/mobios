import { MeshQuery } from '../mesh/bvh';
import { buildTopology, DisjointSet, edgeFold, MinHeap, type Topology } from '../mesh/topology';
import type { MeshData, Vec3 } from '../types';
import { FlowGraph } from './mincut';
import { faceThickness, localThickness, SolidGrid } from './volume';

/**
 * Part map: splits a figure into the pieces a person would name (hat, head, torso, arms…)
 * from geometry alone. See docs/PLANO-MULTIPARTES.md and ADR 0010.
 *
 * 1. Local thickness per face (volumetric, see volume.ts): what tells an arm from the torso, or a
 *    brim from the head, where no crease separates them.
 * 2. Thickness classes: k-means on log thickness + alpha-expansion graph cuts whose smoothness
 *    is cheap across concave folds, so class borders sit on the creases.
 * 3. Regions: connected faces of one class (thin classes also stop at deep valleys); reliefs
 *    that bridge separate bodies are split by host; limbs with two lobes (both legs) are split
 *    at the saddle.
 * 4. Fusion into parts, by rules on the region graph:
 *    - plate: a thin flat region between two bodies joins the one above it (hat brim) and
 *      keeps them apart for good;
 *    - relief: a thin region clinging to or lying on a body is a detail of it (bars, bands,
 *      buttons, ear discs);
 *    - similar: touching bodies of similar thickness are one (two jacket bands); so are bodies a
 *      relief seam lies across (front and back of a head);
 *    - patch: a part surrounded by a bigger one that hardly stands out of it (a face plate);
 *    - extremity: a distal limb segment joins the next one (hand → arm, shoe → leg), never the
 *      torso, never a long thin accessory (a cane);
 *    - crumbs under 2% of the surface join a neighbour.
 * 5. Names from where each part sits (torso = the hub, head above it, hat on the head…).
 *
 * Regions stay as sub-parts so the UI can still colour or separate them. Validated on a real
 * figure across proxy sizes (tests/lab/robust.lab.ts) and on a synthetic one in CI.
 */
export interface PartRegion {
  area: number;
  /** Area-weighted geometric mean thickness (mm). */
  thickness: number;
  centroid: Vec3;
  /** Top-level part this region belongs to. */
  part: number;
  /** Why it joined its part ('core' = the region that seeded it). */
  role: 'core' | 'plate' | 'relief' | 'similar';
}

export interface MapPart {
  id: number;
  name: string;
  regions: number[];
  area: number;
  thickness: number;
  centroid: Vec3;
  min: Vec3;
  max: Vec3;
}

export interface PartMap {
  /** Region id per face of the analysed mesh. */
  faceRegion: Int32Array;
  regions: PartRegion[];
  parts: MapPart[];
  /** Part id per face (convenience: regions[faceRegion[f]].part). */
  facePart: Int32Array;
  timings: Record<string, number>;
}

export interface PartMapOptions {
  /** Target voxel count of the solid grid. */
  voxels?: number;
  classes?: number;
  /** Regions below this share of the total area are absorbed. */
  minShare?: number;
}

export function buildPartMap(mesh: MeshData, opts: PartMapOptions = {}): PartMap {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => {
    const now = performance.now();
    timings[k] = Math.round(now - t0);
    t0 = now;
  };
  const topo = buildTopology(mesh);
  const query = new MeshQuery(mesh);
  const p = mesh.positions;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
  const boxVol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  const h = Math.cbrt(boxVol / (opts.voxels ?? 1_000_000));
  const grid = new SolidGrid(mesh, query, h);
  query.dispose();
  const lt = localThickness(grid.inside, grid.n);
  const thick = faceThickness(topo, grid, lt);
  lap('thickness');
  const cls = thicknessClasses(topo, thick, { k: opts.classes ?? 6 });
  lap('classes');
  const classes = classRegions(topo, cls, (opts.minShare ?? 0.0015) * topo.totalArea, thick);
  const { faceRegion } = classes;
  const hosted = splitReliefByHost(topo, faceRegion, classes.count, thick);
  const { count, siblings } = splitLobes(topo, faceRegion, hosted, thick);
  const graph = regionGraph(topo, faceRegion, count, thick);
  lap('regions');
  const regions = fuse(topo, faceRegion, graph, siblings);
  const parts = collectParts(topo, faceRegion, regions);
  nameParts(parts, graph, regions, lo, hi);
  const facePart = new Int32Array(topo.nf);
  for (let f = 0; f < topo.nf; f++) facePart[f] = regions[faceRegion[f]].part;
  refineFaces(topo, faceRegion, regions, facePart);
  for (const q of parts) q.area = 0;
  for (let f = 0; f < topo.nf; f++) parts[facePart[f]].area += topo.fArea[f];
  lap('fusion');
  return { faceRegion, regions, parts, facePart, timings };
}

/**
 * Faces → thickness classes: 1D k-means on log2(thickness), then alpha-expansion graph cuts
 * (Potts) so class boundaries are smooth and prefer concave creases.
 */
export function thicknessClasses(topo: Topology, thickness: Float32Array, opts: { k?: number; lambda?: number; sweeps?: number } = {}): Int32Array {
  const { nf, fArea, faceNbr, t, p } = topo;
  const k = opts.k ?? 6, lambda = opts.lambda ?? 2, sweeps = opts.sweeps ?? 2;
  const x = new Float64Array(nf);
  for (let f = 0; f < nf; f++) x[f] = Math.log2(Math.max(thickness[f], 0.25));
  // k-means seeded at area-weighted quantiles.
  const order = Array.from(x.keys()).sort((a, b) => x[a] - x[b]);
  const mu = new Float64Array(k);
  {
    let acc = 0, j = 0;
    for (const f of order) {
      acc += fArea[f];
      while (j < k && acc >= ((j + 0.5) / k) * topo.totalArea) mu[j++] = x[f];
    }
  }
  const lab = new Int32Array(nf);
  for (let it = 0; it < 20; it++) {
    const s = new Float64Array(k), w = new Float64Array(k);
    for (let f = 0; f < nf; f++) {
      let best = 0;
      for (let j = 1; j < k; j++) if (Math.abs(x[f] - mu[j]) < Math.abs(x[f] - mu[best])) best = j;
      lab[f] = best;
      s[best] += x[f] * fArea[f];
      w[best] += fArea[f];
    }
    for (let j = 0; j < k; j++) if (w[j]) mu[j] = s[j] / w[j];
  }
  const data = (f: number, l: number) => fArea[f] * Math.min(4, (x[f] - mu[l]) ** 2 / 0.25);
  // Smoothness per edge: its length, cheap across concave folds.
  const ea: number[] = [], eb: number[] = [], ew: number[] = [];
  for (let f = 0; f < nf; f++)
    for (let j = 0; j < 3; j++) {
      const g = faceNbr[f * 3 + j];
      if (g <= f) continue;
      const a = t[f * 3 + j], b = t[f * 3 + ((j + 1) % 3)];
      const len = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      const fold = edgeFold(topo, f, j);
      ea.push(f);
      eb.push(g);
      ew.push(lambda * len * (fold > 0 ? Math.max(0.05, 1 - fold / 1.2) : 1));
    }
  const S = nf, T = nf + 1;
  const c0 = new Float64Array(nf), c1 = new Float64Array(nf);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let changed = 0;
    for (let alpha = 0; alpha < k; alpha++) {
      // Binary move per face: 0 = keep its label (source side), 1 = switch to alpha (sink side).
      const g = new FlowGraph(nf + 2);
      for (let f = 0; f < nf; f++) {
        c0[f] = lab[f] === alpha ? 0 : data(f, lab[f]);
        c1[f] = lab[f] === alpha ? 0 : data(f, alpha);
      }
      for (let e = 0; e < ea.length; e++) {
        const u = ea[e], v = eb[e], w = ew[e];
        const lu = lab[u], lv = lab[v];
        // E00 = w[lu≠lv], E01 = w[lu≠α], E10 = w[α≠lv], E11 = 0 (Kolmogorov–Zabih decomposition).
        const A = lu !== lv ? w : 0, B = lu !== alpha ? w : 0, C = alpha !== lv ? w : 0;
        c0[u] += A; // constant A folded into u's "keep" cost and cancelled on "switch"
        c1[u] += C;
        c1[v] -= C;
        const pair = B + C - A;
        if (pair > 0) g.addEdge(u, v, pair, 0);
      }
      for (let f = 0; f < nf; f++) {
        const m = Math.min(c0[f], c1[f]);
        if (c1[f] - m > 0) g.addEdge(S, f, c1[f] - m, 0);
        if (c0[f] - m > 0) g.addEdge(f, T, c0[f] - m, 0);
      }
      g.maxflow(S, T);
      const keep = g.sourceSide(S);
      for (let f = 0; f < nf; f++)
        if (!keep[f] && lab[f] !== alpha) {
          lab[f] = alpha;
          changed++;
        }
    }
    if (!changed) break;
  }
  return lab;
}

/** Fold (radians) of a valley deep enough to separate regions of a thin class. */
const CREASE = 1;
/** Classes thinner than this fraction of the thickest are details and plates. */
const THIN = 0.17;

/** Connected components of equal class; components under `minArea` join their longest-bordering neighbour. */
function classRegions(topo: Topology, cls: Int32Array, minArea: number, thick: Float32Array): { faceRegion: Int32Array; count: number } {
  const { nf, faceNbr, fArea } = topo;
  // Thin classes (details, plates) also split at deep valleys: a brim and the bars of a face cage
  // meeting it at a right angle are different things even at the same thickness.
  const k = Math.max(...cls) + 1;
  const sum = new Float64Array(k), w = new Float64Array(k);
  for (let f = 0; f < nf; f++) {
    sum[cls[f]] += fArea[f] * Math.log2(Math.max(thick[f], 0.25));
    w[cls[f]] += fArea[f];
  }
  const mean = Array.from(sum, (s, c) => (w[c] ? s / w[c] : -Infinity));
  const thinClass = mean.map((m) => m < Math.max(...mean) + Math.log2(THIN));
  const ds = new DisjointSet(nf);
  for (let f = 0; f < nf; f++) ds.add(f);
  const area = Float64Array.from(fArea);
  const join = (a: number, b: number) => {
    a = ds.find(a);
    b = ds.find(b);
    if (a === b) return;
    if (area[a] < area[b]) [a, b] = [b, a];
    ds.parent[b] = a;
    area[a] += area[b];
  };
  for (let f = 0; f < nf; f++)
    for (let j = 0; j < 3; j++) {
      const g = faceNbr[f * 3 + j];
      if (g > f && cls[f] === cls[g] && (!thinClass[cls[f]] || edgeFold(topo, f, j) < CREASE)) join(f, g);
    }
  // Absorb small components, smallest first, into the neighbour sharing the most boundary.
  for (let pass = 0; pass < 8; pass++) {
    const border = new Map<number, Map<number, number>>();
    for (let f = 0; f < nf; f++) {
      const a = ds.find(f);
      if (area[a] >= minArea) continue;
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g < 0) continue;
        const b = ds.find(g);
        if (b === a) continue;
        let m = border.get(a);
        if (!m) border.set(a, (m = new Map()));
        m.set(b, (m.get(b) ?? 0) + edgeLength(topo, f, j));
      }
    }
    if (!border.size) break;
    const small = [...border.keys()].sort((a, b) => area[a] - area[b]);
    for (const a of small) {
      if (ds.find(a) !== a || area[a] >= minArea) continue;
      let best = -1, bestLen = 0;
      for (const [b, len] of border.get(a)!)
        if (len > bestLen) {
          bestLen = len;
          best = b;
        }
      if (best >= 0) join(a, best);
    }
  }
  const faceRegion = new Int32Array(nf);
  const id = new Map<number, number>();
  for (let f = 0; f < nf; f++) {
    const r = ds.find(f);
    let l = id.get(r);
    if (l === undefined) id.set(r, (l = id.size));
    faceRegion[f] = l;
  }
  return { faceRegion, count: id.size };
}

const edgeLength = (topo: Topology, f: number, j: number) => {
  const { t, p } = topo;
  const a = t[f * 3 + j], b = t[f * 3 + ((j + 1) % 3)];
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
};

/**
 * Splits thin relief regions that bridge separate bodies (a hat band and a face cage joined by
 * the straps between them): every face goes with the clearly thicker region right under it. Only
 * regions that mostly lie on hosts are split, and only when those hosts do not touch each other;
 * a plate such as a brim, whose rim lies on nothing, is left alone.
 */
function splitReliefByHost(topo: Topology, faceRegion: Int32Array, count: number, thick: Float32Array): number {
  const { nf, faceNbr, fArea } = topo;
  const cells = new FaceCells(topo, 2 * Math.sqrt(topo.totalArea / nf) + 1e-6);
  const logT = new Float64Array(count), area = new Float64Array(count);
  for (let f = 0; f < nf; f++) {
    area[faceRegion[f]] += fArea[f];
    logT[faceRegion[f]] += fArea[f] * Math.log2(Math.max(thick[f], 0.25));
  }
  for (let r = 0; r < count; r++) logT[r] /= area[r] || 1;
  const faces: number[][] = Array.from({ length: count }, () => []);
  for (let f = 0; f < nf; f++) faces[faceRegion[f]].push(f);
  const adjacent = new Set<number>();
  for (let f = 0; f < nf; f++)
    for (let j = 0; j < 3; j++) {
      const g = faceNbr[f * 3 + j];
      if (g >= 0 && faceRegion[g] !== faceRegion[f]) adjacent.add(faceRegion[f] * 65536 + faceRegion[g]);
    }
  const touches = (a: number, b: number) => adjacent.has(a * 65536 + b);
  let next = count;
  for (let r = 0; r < count; r++) {
    const own = faces[r];
    if (area[r] < topo.totalArea * 0.005) continue;
    const t = 2 ** logT[r];
    const isHost = (g: number) => faceRegion[g] < count && faceRegion[g] !== r && logT[faceRegion[g]] - logT[r] >= Math.log2(HOST);
    // Cheap checks first: touches a clearly thicker region, and a sample lies on hosts.
    if (!own.some((f) => [0, 1, 2].some((j) => faceNbr[f * 3 + j] >= 0 && isHost(faceNbr[f * 3 + j])))) continue;
    const step = Math.max(1, Math.floor(own.length / 300));
    let miss = 0, tried = 0;
    for (let i = 0; i < own.length; i += step, tried++) if (cells.nearest(own[i], isHost, t * RELIEF) < 0) miss++;
    if (miss > tried * 0.5) continue;
    const host = new Int32Array(own.length).fill(-1);
    const share = new Map<number, number>();
    let found = 0;
    own.forEach((f, i) => {
      const g = cells.nearest(f, isHost, t * RELIEF);
      if (g < 0) return;
      host[i] = faceRegion[g];
      found++;
      share.set(host[i], (share.get(host[i]) ?? 0) + fArea[f]);
    });
    if (found < own.length * 0.5) continue;
    const hosts = [...share.entries()].filter(([, a]) => a >= area[r] * 0.2).map(([h]) => h);
    // Only a bridge between bodies that do not touch each other (band on the dome, cage on the
    // head); a hand resting where torso and leg meet stays whole.
    if (hosts.length < 2 || hosts.some((h, i) => hosts.some((k, j) => j > i && touches(h, k)))) continue;
    // Faces without a major host take a neighbour's (breadth-first inside the region).
    const local = new Map(own.map((f, i) => [f, i]));
    const queue: number[] = [];
    own.forEach((_, i) => {
      if (!hosts.includes(host[i])) host[i] = -1;
      else queue.push(i);
    });
    for (let q = 0; q < queue.length; q++) {
      const f = own[queue[q]];
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        const k = g >= 0 ? local.get(g) : undefined;
        if (k !== undefined && host[k] < 0) {
          host[k] = host[queue[q]];
          queue.push(k);
        }
      }
    }
    const byHost = new Map<number, number>();
    own.forEach((f, i) => {
      if (host[i] < 0 || host[i] === hosts[0]) return;
      let id = byHost.get(host[i]);
      if (id === undefined) byHost.set(host[i], (id = next++));
      faceRegion[f] = id;
    });
  }
  return next;
}

/**
 * Splits limb-like regions with several lobes (both legs in one region, joined under a jacket):
 * walking away from the region's attachment to its thickest neighbour, the superlevel sets of
 * the geodesic distance break into separate lobes at a saddle (the crotch). Lobes that are big
 * and long enough become regions of their own; the rest of the region is shared out by a
 * geodesic Voronoi from the lobes.
 */
function splitLobes(topo: Topology, faceRegion: Int32Array, count: number, thick: Float32Array): { count: number; siblings: Set<number> } {
  const siblings = new Set<number>();
  const { nf, faceNbr, fArea } = topo;
  const cells = new FaceCells(topo, 1);
  const c = cells.c;
  const dist = (f: number, g: number) => Math.hypot(c[f * 3] - c[g * 3], c[f * 3 + 1] - c[g * 3 + 1], c[f * 3 + 2] - c[g * 3 + 2]);
  const faces: number[][] = Array.from({ length: count }, () => []);
  for (let f = 0; f < nf; f++) faces[faceRegion[f]].push(f);
  const logT: number[] = new Array(count).fill(0), area: number[] = new Array(count).fill(0);
  for (let f = 0; f < nf; f++) {
    area[faceRegion[f]] += fArea[f];
    logT[faceRegion[f]] += fArea[f] * Math.log2(Math.max(thick[f], 0.25));
  }
  for (let r = 0; r < count; r++) logT[r] /= area[r] || 1;
  let next = count;
  const d = new Float64Array(nf).fill(Infinity);
  const queue = Array.from({ length: count }, (_, i) => i);
  while (queue.length) {
    const r = queue.pop()!;
    if (area[r] < topo.totalArea * 0.01) continue;
    // Attachment: border with the thickest neighbour, if clearly thicker.
    const nbT = new Map<number, number>();
    for (const f of faces[r])
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g >= 0 && faceRegion[g] !== r) nbT.set(faceRegion[g], 0);
      }
    let host = -1;
    for (const n of nbT.keys()) if (n < count && (host < 0 || logT[n] > logT[host])) host = n;
    if (host < 0 || logT[host] - logT[r] < Math.log2(1.3)) continue;
    const tr = 2 ** logT[r];
    // Geodesic distance from the attachment.
    const heap = new MinHeap(1024);
    for (const f of faces[r]) {
      d[f] = Infinity;
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g >= 0 && faceRegion[g] === host) {
          d[f] = 0;
          break;
        }
      }
      if (d[f] === 0) heap.push(f, 0);
    }
    // Limbs are tubes; a flat plate (a base under two feet) is not a pair of lobes.
    if (flatness(topo, faces[r]) > 0.6) continue;
    while (heap.size) {
      const key = heap.topKey();
      const f = heap.pop();
      if (key > d[f]) continue;
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g < 0 || faceRegion[g] !== r) continue;
        const nd = key + dist(f, g);
        if (nd < d[g]) {
          d[g] = nd;
          heap.push(g, nd);
        }
      }
    }
    // Superlevel filtration: add faces from far to near, union-find over the added ones.
    const order = faces[r].filter((f) => Number.isFinite(d[f])).sort((a, b) => d[b] - d[a]);
    const ds = new Map<number, number>();
    const cArea = new Map<number, number>(), cTop = new Map<number, number>();
    const find = (x: number): number => {
      let y = x;
      while (ds.get(y) !== y) y = ds.get(y)!;
      ds.set(x, y);
      return y;
    };
    const significant = (root: number, level: number) => cArea.get(root)! >= area[r] * 0.15 && cTop.get(root)! - level >= 1.5 * tr;
    let lobes: [number, number] | null = null;
    for (const f of order) {
      ds.set(f, f);
      cArea.set(f, fArea[f]);
      cTop.set(f, d[f]);
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g < 0 || !ds.has(g)) continue;
        const a = find(f), b = find(g);
        if (a === b) continue;
        if (significant(a, d[f]) && significant(b, d[f])) {
          lobes = [a, b];
          break;
        }
        ds.set(b, a);
        cArea.set(a, cArea.get(a)! + cArea.get(b)!);
        cTop.set(a, Math.max(cTop.get(a)!, cTop.get(b)!));
      }
      if (lobes) break;
    }
    if (!lobes) continue;
    // Faces beyond the saddle keep their lobe; the rest go to the nearer lobe (geodesic Voronoi).
    const owner = new Map<number, number>();
    const h2 = new MinHeap(1024);
    const g2 = new Map<number, number>();
    for (const f of faces[r]) {
      if (!ds.has(f)) continue;
      const root = find(f);
      const k = root === lobes[0] ? 0 : root === lobes[1] ? 1 : -1;
      if (k < 0) continue;
      owner.set(f, k);
      g2.set(f, 0);
      h2.push(f, 0);
    }
    while (h2.size) {
      const key = h2.topKey();
      const f = h2.pop();
      if (key > g2.get(f)!) continue;
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g < 0 || faceRegion[g] !== r) continue;
        const nd = key + dist(f, g);
        if (nd < (g2.get(g) ?? Infinity)) {
          g2.set(g, nd);
          owner.set(g, owner.get(f)!);
          h2.push(g, nd);
        }
      }
    }
    const nr = next++;
    const kept: number[] = [], moved: number[] = [];
    for (const f of faces[r]) {
      if (owner.get(f) === 1) {
        faceRegion[f] = nr;
        moved.push(f);
      } else kept.push(f);
    }
    faces[r] = kept;
    faces.push(moved);
    let ar = 0, an = 0;
    for (const f of kept) ar += fArea[f];
    for (const f of moved) an += fArea[f];
    area[r] = ar;
    area.push(an);
    logT.push(logT[r]); // same thickness as the parent; the region graph recomputes it
    siblings.add(r * 65536 + nr);
    queue.push(r, nr);
  }
  return { count: next, siblings };
}

interface Border {
  length: number;
  /** Length of the border lying on a concave fold. */
  concave: number;
  /** Length-weighted mean height of the border. */
  z: number;
}

interface RegionGraph {
  count: number;
  area: Float64Array;
  logThick: Float64Array;
  centroid: Float64Array;
  /** borders[a].get(b): shared boundary (symmetric). */
  borders: Map<number, Border>[];
}

function regionGraph(topo: Topology, faceRegion: Int32Array, count: number, thick: Float32Array): RegionGraph {
  const { nf, faceNbr, fArea, t, p } = topo;
  const area = new Float64Array(count), logThick = new Float64Array(count), centroid = new Float64Array(count * 3);
  for (let f = 0; f < nf; f++) {
    const r = faceRegion[f], a = fArea[f];
    area[r] += a;
    logThick[r] += a * Math.log2(Math.max(thick[f], 0.25));
    for (let k = 0; k < 3; k++) centroid[r * 3 + k] += (a * (p[t[f * 3] * 3 + k] + p[t[f * 3 + 1] * 3 + k] + p[t[f * 3 + 2] * 3 + k])) / 3;
  }
  for (let r = 0; r < count; r++) {
    logThick[r] /= area[r] || 1;
    for (let k = 0; k < 3; k++) centroid[r * 3 + k] /= area[r] || 1;
  }
  const borders: Map<number, Border>[] = Array.from({ length: count }, () => new Map());
  for (let f = 0; f < nf; f++)
    for (let j = 0; j < 3; j++) {
      const g = faceNbr[f * 3 + j];
      if (g <= f) continue;
      const a = faceRegion[f], b = faceRegion[g];
      if (a === b) continue;
      const len = edgeLength(topo, f, j);
      const va = t[f * 3 + j], vb = t[f * 3 + ((j + 1) % 3)];
      const z = (p[va * 3 + 2] + p[vb * 3 + 2]) / 2;
      const concave = edgeFold(topo, f, j) > 0.35 ? len : 0;
      let e = borders[a].get(b);
      if (!e) {
        e = { length: 0, concave: 0, z: 0 };
        borders[a].set(b, e);
        borders[b].set(a, e);
      }
      e.length += len;
      e.concave += concave;
      e.z += z * len;
    }
  // Each border object is shared by both regions: normalise it once.
  const seen = new Set<Border>();
  for (const m of borders)
    for (const e of m.values())
      if (!seen.has(e)) {
        seen.add(e);
        e.z /= e.length || 1;
      }
  return { count, area, logThick, centroid, borders };
}

/**
 * Whether a set of faces lies on a host surface (90% within RELIEF × `thickness` of the nearest
 * host face) and, if so, which host part most of them lie on. A relief (bars, buttons, goggles, a
 * scarf) lies on its host; a limb or a hand stands away from it, even when it touches the host
 * at both ends.
 */
function reliefHost(cells: FaceCells, faces: number[], partOf: (f: number) => number, hosts: Set<number>, thickness: number): number {
  const limit = thickness * RELIEF;
  let far = 0;
  const votes = new Map<number, number>();
  // A strided sample is enough for a 90% test and keeps big parts cheap.
  const step = Math.max(1, Math.floor(faces.length / 400));
  const n0 = Math.ceil(faces.length / step);
  for (let i = 0; i < faces.length; i += step) {
    const g = cells.nearest(faces[i], (x) => hosts.has(partOf(x)), limit);
    if (g < 0) {
      if (++far > n0 * 0.1) return -1;
      continue;
    }
    const q = partOf(g);
    votes.set(q, (votes.get(q) ?? 0) + 1);
  }
  let best = -1, n = 0;
  for (const [q, v] of votes)
    if (v > n) {
      n = v;
      best = q;
    }
  return best;
}

/** Uniform hash of face centroids for "nearest face satisfying …" queries. */
class FaceCells {
  private cell: number;
  private map = new Map<number, number[]>();
  readonly c: Float32Array;
  constructor(topo: Topology, cell: number) {
    const { nf, p, t } = topo;
    this.cell = cell;
    this.c = new Float32Array(nf * 3);
    for (let f = 0; f < nf; f++) {
      for (let k = 0; k < 3; k++) this.c[f * 3 + k] = (p[t[f * 3] * 3 + k] + p[t[f * 3 + 1] * 3 + k] + p[t[f * 3 + 2] * 3 + k]) / 3;
      const key = this.key(Math.floor(this.c[f * 3] / cell), Math.floor(this.c[f * 3 + 1] / cell), Math.floor(this.c[f * 3 + 2] / cell));
      let l = this.map.get(key);
      if (!l) this.map.set(key, (l = []));
      l.push(f);
    }
  }
  private key(i: number, j: number, k: number) {
    return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  }
  /** Nearest face accepted by `ok` within `limit` of face f, or −1. */
  nearest(f: number, ok: (g: number) => boolean, limit: number): number {
    const c = this.c, cell = this.cell;
    const x = c[f * 3], y = c[f * 3 + 1], z = c[f * 3 + 2];
    const r = Math.ceil(limit / cell);
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    let best = limit * limit, found = -1;
    for (let i = ci - r; i <= ci + r; i++)
      for (let j = cj - r; j <= cj + r; j++)
        for (let k = ck - r; k <= ck + r; k++) {
          const l = this.map.get(this.key(i, j, k));
          if (!l) continue;
          for (const g of l) {
            const d = (c[g * 3] - x) ** 2 + (c[g * 3 + 1] - y) ** 2 + (c[g * 3 + 2] - z) ** 2;
            if (d < best && ok(g)) {
              best = d;
              found = g;
            }
          }
        }
    return found;
  }
}

/** Area-weighted mean |normal · Z| of faces: 1 for a horizontal plate, ~0.3 for a vertical one. */
function flatness(topo: Topology, faces: number[]): number {
  let s = 0, a = 0;
  for (const f of faces) {
    s += Math.abs(topo.fNormal[f * 3 + 2]) * topo.fArea[f];
    a += topo.fArea[f];
  }
  return a ? s / a : 0;
}

/** Thicker-than ratio for a neighbour to count as the body a thin plate sits on. */
const PLATE = 2.5;
/** Thicker-than ratio for a neighbour to host a relief. */
const HOST = 2;
/**
 * Attachment of a thin part to its hosts: border × thickness / area. A relief clings along its
 * whole length (cage bars 1.4–5, an ear disc ~3); a limb hangs from one end (arm ~0.35, a
 * forearm or hand resting on the hip up to ~0.9, a cane ~0.1).
 */
const CLING = 1.2;
/** Relief height (in own thicknesses) under which a thin part is a detail of its host. */
const RELIEF = 0.6;
/** Thickness ratio above which touching parts are one (raised by a concave border). */
const SIMILAR = 0.7;
/** Thickness ratio of two bodies a relief seam lies across. */
const SEAM = 0.6;
/** Depth / attachment radius under which a surrounded part is a patch of its surroundings. */
const PATCH = 0.6;
/** Thickest next segment a limb extremity joins (hand → forearm). */
const LIMB = 2.5;

function fuse(topo: Topology, faceRegion: Int32Array, g: RegionGraph, siblings: Set<number>): PartRegion[] {
  const { count, area, logThick, borders } = g;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const members: number[][] = Array.from({ length: count }, (_, i) => [i]);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const role: PartRegion['role'][] = new Array(count).fill('core');
  // Part stats on the root: area, and the thickness of its body (cores and similar regions only;
  // absorbed reliefs and plates do not thin it out).
  const pArea = Float64Array.from(area), pLog = Float64Array.from(logThick), pBody = Float64Array.from(area);
  const union = (child: number, into: number, why: PartRegion['role']) => {
    const a = find(child), b = find(into);
    if (a === b) return;
    parent[a] = b;
    for (const m of members[a]) if (why !== 'similar' || role[m] === 'core') role[m] = why;
    members[b].push(...members[a]);
    members[a] = [];
    if (why === 'similar') {
      pLog[b] = (pLog[b] * pBody[b] + pLog[a] * pBody[a]) / (pBody[a] + pBody[b]);
      pBody[b] += pBody[a];
    }
    pArea[b] += pArea[a];
  };
  const thick = (root: number) => 2 ** pLog[root];
  const regionFaces: number[][] = Array.from({ length: count }, () => []);
  for (let f = 0; f < faceRegion.length; f++) regionFaces[faceRegion[f]].push(f);
  const facesOf = (root: number) => members[root].flatMap((r) => regionFaces[r]);
  const pairKey = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
  /**
   * Borders of a part with the other current parts. `contact` keeps only real body contact:
   * not through an absorbed plate (hat and head touch only through the brim), not relief to
   * relief (hat band ornament against the face bars), never between the two lobes of a split.
   */
  const partBorders = (root: number, contact: boolean) => {
    const m = new Map<number, Border>();
    for (const r of members[root])
      for (const [n, e] of borders[r]) {
        const q = find(n);
        if (q === root || siblings.has(pairKey(r, n))) continue;
        if (contact && (role[r] === 'plate' || role[n] === 'plate' || (role[r] === 'relief' && role[n] === 'relief'))) continue;
        const acc = m.get(q) ?? { length: 0, concave: 0, z: 0 };
        acc.z = (acc.z * acc.length + e.z * e.length) / (acc.length + e.length);
        acc.length += e.length;
        acc.concave += e.concave;
        m.set(q, acc);
      }
    return m;
  };
  const roots = () =>
    Array.from({ length: count }, (_, i) => i)
      .filter((r) => find(r) === r)
      .sort((a, b) => pArea[a] - pArea[b]);
  const cells = new FaceCells(topo, 2 * Math.sqrt(topo.totalArea / topo.nf) + 1e-6);
  const maxThick = 2 ** Math.max(...logThick);
  const partOfFace = (f: number) => find(faceRegion[f]);
  // Bodies a flat plate lies between (hat dome above a brim, head below): never one part.
  const apart: [number, number][] = [];
  const keptApart = (a: number, b: number) => apart.some(([x, y]) => (find(x) === a && find(y) === b) || (find(x) === b && find(y) === a));

  // 1. Plates and reliefs: thin parts decide where they belong, smallest first, until stable.
  const thinParts = () => {
    let any = false;
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const r of roots()) {
        if (find(r) !== r) continue;
        const nb = partBorders(r, false);
        const total = [...nb.values()].reduce((s, e) => s + e.length, 0);
        const plates = [...nb.entries()].filter(([n]) => thick(n) > thick(r) * PLATE);
        const toThick = plates.reduce((s, [, e]) => s + e.length, 0);
        const major = plates.filter(([, e]) => e.length >= 0.2 * toThick);
        // Sandwiched plate. Lying flat (a brim between hat and head) it belongs to the body above
        // it; standing (a scarf between neck and chest) to the body it hangs along.
        if (major.length >= 2 && toThick >= 0.5 * total) {
          const flat = flatness(topo, facesOf(r)) > 0.6;
          const to = major.reduce((x, y) => ((flat ? y[1].z > x[1].z : y[1].length > x[1].length) ? y : x));
          // Flat with one body above and one below (hat over head): those stay apart for good.
          if (flat) for (const [n, e] of major) if (n !== to[0] && to[1].z - e.z > thick(r)) apart.push([to[0], n]);
          // Only a flat plate separates; a standing one (a scarf, the frame of a face cage) hangs
          // along its body like a relief, and bodies may still touch through it.
          union(r, to[0], flat ? 'plate' : 'relief');
          changed = true;
          continue;
        }
        // A relief belongs to the body it lies on: borders with an absorbed plate (bars running
        // under a brim that is already part of the hat) do not count.
        const onBody = partBorders(r, true);
        const hosts = new Set([...onBody.keys()].filter((n) => thick(n) > thick(r) * HOST));
        if (!hosts.size) continue;
        // Not a relief when it continues a neighbour of its own thickness (a scarf on the chest).
        // Thin decorations (under 30% of the thickest body) are always relief candidates.
        if (thick(r) >= 0.3 * maxThick && [...nb.entries()].some(([n, e]) => e.length >= 0.15 * total && 2 ** -Math.abs(pLog[n] - pLog[r]) >= SIMILAR)) continue;
        // Clinging along its whole length (bars, a band, an ear disc) or lying close on the host.
        const toHosts = [...onBody.entries()].filter(([n]) => hosts.has(n)).reduce((s, [, e]) => s + e.length, 0);
        const clinging = (toHosts * thick(r)) / pArea[r] >= CLING;
        const host = clinging
          ? [...onBody.entries()].filter(([n]) => hosts.has(n)).reduce((x, y) => (y[1].length > x[1].length ? y : x))[0]
          : reliefHost(cells, facesOf(r), partOfFace, hosts, thick(r));
        if (host >= 0) {
          union(r, host, 'relief');
          changed = true;
        }
      }
      if (!changed) break;
      any = true;
    }
    return any;
  };

  // 2. Similar thickness without a concave neck: same part (two jacket bands, head and ear).
  const similarParts = () => {
    let any = false;
    for (;;) {
      let best: [number, number, number] | null = null;
      for (const a of roots())
        for (const [b, e] of partBorders(a, true)) {
          if (a > b) continue;
          const ratio = 2 ** -Math.abs(pLog[a] - pLog[b]);
          const need = SIMILAR + 0.1 * (e.concave / e.length);
          if (ratio >= need && (!best || ratio - need > best[2]) && !keptApart(a, b)) best = [a, b, ratio - need];
        }
      // A relief lying across two bodies of similar thickness is a seam on one surface (the bars
      // of a face cage between the front and the back of a head): those bodies are one part.
      if (!best)
        for (let r = 0; r < count; r++) {
          if (role[r] !== 'relief') continue;
          const a = find(r);
          const share = new Map<number, number>();
          let total = 0;
          for (const [n, e] of borders[r]) {
            if (role[n] === 'plate') continue;
            const q = find(n);
            share.set(q, (share.get(q) ?? 0) + e.length);
            total += e.length;
          }
          if ((share.get(a) ?? 0) < 0.25 * total) continue;
          for (const [b, len] of share) {
            if (b === a || len < 0.25 * total) continue;
            const ratio = 2 ** -Math.abs(pLog[a] - pLog[b]);
            if (ratio >= SEAM && (!best || ratio > best[2]) && !keptApart(a, b)) best = [a, b, ratio];
          }
        }
      if (!best) break;
      const [a, b] = best;
      if (pArea[a] < pArea[b]) union(a, b, 'similar');
      else union(b, a, 'similar');
      any = true;
    }
    return any;
  };
  // 3. Patches: a part almost surrounded by one bigger part that hardly stands out of it, or
  // lying within the bounds of a much bigger one (a face plate, a mouth grille or an ear disc on
  // a head), belongs to it. A limb is surrounded at the shoulder too, but reaches far beyond the
  // size of its attachment and outside the torso.
  const standsOut = (r: number, q: number, border: number) => {
    const d = new Map<number, number>();
    const heap = new MinHeap(1024);
    for (const f of facesOf(r))
      for (let j = 0; j < 3; j++) {
        const h = topo.faceNbr[f * 3 + j];
        if (h >= 0 && find(faceRegion[h]) === q) {
          d.set(f, 0);
          heap.push(f, 0);
          break;
        }
      }
    let far = 0;
    const c = cells.c;
    while (heap.size) {
      const key = heap.topKey();
      const f = heap.pop();
      if (key > (d.get(f) ?? Infinity)) continue;
      far = Math.max(far, key);
      for (let j = 0; j < 3; j++) {
        const h = topo.faceNbr[f * 3 + j];
        if (h < 0 || find(faceRegion[h]) !== r) continue;
        const nd = key + Math.hypot(c[f * 3] - c[h * 3], c[f * 3 + 1] - c[h * 3 + 1], c[f * 3 + 2] - c[h * 3 + 2]);
        if (nd < (d.get(h) ?? Infinity)) {
          d.set(h, nd);
          heap.push(h, nd);
        }
      }
    }
    // Attachment radius from its length (a loop of length L encloses radius L / 2π).
    return far / (border / (2 * Math.PI)) >= PATCH;
  };
  const bounds = (root: number) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of facesOf(root))
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], cells.c[f * 3 + k]);
        hi[k] = Math.max(hi[k], cells.c[f * 3 + k]);
      }
    return { lo, hi };
  };
  /** Share of r's faces inside q's bounding box (grown by 5% of its size). */
  const inside = (r: number, q: number) => {
    const { lo, hi } = bounds(q);
    const m = [0, 1, 2].map((k) => (hi[k] - lo[k]) * 0.05);
    const own = facesOf(r);
    let n = 0;
    for (const f of own) if ([0, 1, 2].every((k) => cells.c[f * 3 + k] >= lo[k] - m[k] && cells.c[f * 3 + k] <= hi[k] + m[k])) n++;
    return n / Math.max(1, own.length);
  };
  const patchParts = () => {
    let any = false;
    for (const r of roots()) {
      if (find(r) !== r) continue;
      // Real contact only: a face touching the hat through the brim is still inside the head.
      const nb = [...partBorders(r, true).entries()];
      if (!nb.length) continue;
      const total = nb.reduce((s, [, e]) => s + e.length, 0);
      const [q, e] = nb.reduce((x, y) => (y[1].length > x[1].length ? y : x));
      // The host is bigger and not much thinner (a head never becomes a patch of its face cage).
      if (pArea[q] <= pArea[r] || thick(q) < 0.6 * thick(r) || keptApart(r, q)) continue;
      // Either clearly surrounded and flat, or lying within a much bigger part's bounds (a mouth
      // grille, an ear disc on a head); arms and legs are neither (the torso is only ~3× an arm).
      const surrounded = e.length >= 0.75 * total && !standsOut(r, q, e.length);
      const within = e.length >= 0.5 * total && pArea[q] >= 4 * pArea[r] && inside(r, q) >= 0.9;
      if (!surrounded && !within) continue;
      union(r, q, 'relief');
      any = true;
    }
    return any;
  };

  // Alternate: once similar pieces have come together (a head made of several regions), a plate
  // can see that it is sandwiched between two bodies, and a patch what surrounds it.
  thinParts();
  for (let round = 0; round < 6; round++) {
    const merged = similarParts();
    const patched = patchParts();
    if (!merged && !patched) break;
    thinParts();
  }

  // 4. Extremities: a distal limb segment joins the next, thicker segment towards the body
  // (hand → forearm → upper arm, toe → shoe → leg), never a junction (the torso: three or more
  // neighbours) and never a long thin accessory (a cane).
  const significant = (root: number) => {
    const nb = partBorders(root, true);
    const total = [...nb.values()].reduce((s, e) => s + e.length, 0);
    return [...nb.entries()].filter(([, e]) => e.length >= 0.1 * total);
  };
  const longThin = (root: number) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of facesOf(root))
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], cells.c[f * 3 + k]);
        hi[k] = Math.max(hi[k], cells.c[f * 3 + k]);
      }
    return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) > 6 * thick(root);
  };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const r of roots()) {
      if (find(r) !== r || longThin(r)) continue;
      const own = significant(r);
      if (own.length >= 3) continue; // a junction is never an extremity
      const next = own.filter(([n]) => thick(n) > thick(r) && thick(n) <= thick(r) * LIMB && significant(n).length < 3);
      if (!next.length) continue;
      const to = next.reduce((x, y) => (y[1].length > x[1].length ? y : x));
      union(r, to[0], 'similar');
      changed = true;
    }
    if (!changed) break;
  }

  // 5. Leftover crumbs (< 2% of the surface, not an accessory) join the neighbour they share most
  // border with; degenerate slivers with no border at all join the biggest part.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const r of roots()) {
      if (find(r) !== r || pArea[r] >= topo.totalArea * 0.02 || longThin(r)) continue;
      const nb = [...partBorders(r, false).entries()];
      if (!nb.length) {
        if (pArea[r] < topo.totalArea * 1e-4) {
          const biggest = roots().pop()!;
          if (biggest !== r) {
            union(r, biggest, 'relief');
            changed = true;
          }
        }
        continue;
      }
      // Prefer the next limb segment (a hand resting on the hip still belongs to its arm).
      const limb = nb.filter(([n]) => thick(n) > thick(r) && thick(n) <= thick(r) * LIMB && significant(n).length < 3);
      const to = (limb.length ? limb : nb).reduce((x, y) => (y[1].length > x[1].length ? y : x));
      union(r, to[0], 'relief');
      changed = true;
    }
    if (!changed) break;
  }

  return Array.from({ length: count }, (_, r) => ({
    area: area[r],
    thickness: 2 ** logThick[r],
    centroid: [g.centroid[r * 3], g.centroid[r * 3 + 1], g.centroid[r * 3 + 2]] as Vec3,
    part: find(r),
    role: role[r],
  }));
}

/**
 * Face-level touch-ups after fusion:
 * - standing faces of a flat plate that lie on a body of another part go to that body (bars of a
 *   face cage that run up under a brim and ended up in the brim's region);
 * - islands under 0.2% of the surface join the part around them.
 */
function refineFaces(topo: Topology, faceRegion: Int32Array, regions: PartRegion[], facePart: Int32Array) {
  const { nf, fNormal, fArea, faceNbr } = topo;
  const cells = new FaceCells(topo, 2 * Math.sqrt(topo.totalArea / nf) + 1e-6);
  const body = (g: number) => {
    const role = regions[faceRegion[g]].role;
    return role === 'core' || role === 'similar';
  };
  const moved: [number, number][] = [];
  for (let f = 0; f < nf; f++) {
    const r = regions[faceRegion[f]];
    if (r.role !== 'plate' || Math.abs(fNormal[f * 3 + 2]) >= 0.5) continue;
    const g = cells.nearest(f, (x) => body(x) && facePart[x] !== facePart[f], r.thickness * 0.8);
    if (g >= 0) moved.push([f, facePart[g]]);
  }
  for (const [f, p] of moved) facePart[f] = p;
  // Islands: connected pieces of a part smaller than 0.2% of the surface.
  const minArea = topo.totalArea * 0.002;
  for (let pass = 0; pass < 3; pass++) {
    const seen = new Uint8Array(nf);
    let changed = false;
    for (let s = 0; s < nf; s++) {
      if (seen[s]) continue;
      const p = facePart[s];
      const comp = [s];
      seen[s] = 1;
      let area = 0;
      const border = new Map<number, number>();
      for (let i = 0; i < comp.length; i++) {
        const f = comp[i];
        area += fArea[f];
        for (let j = 0; j < 3; j++) {
          const g = faceNbr[f * 3 + j];
          if (g < 0) continue;
          if (facePart[g] !== p) border.set(facePart[g], (border.get(facePart[g]) ?? 0) + edgeLength(topo, f, j));
          else if (!seen[g]) {
            seen[g] = 1;
            comp.push(g);
          }
        }
      }
      if (area >= minArea || !border.size) continue;
      const to = [...border.entries()].reduce((x, y) => (y[1] > x[1] ? y : x))[0];
      for (const f of comp) facePart[f] = to;
      changed = true;
    }
    if (!changed) break;
  }
}

function collectParts(topo: Topology, faceRegion: Int32Array, regions: PartRegion[]): MapPart[] {
  const byRoot = new Map<number, number>();
  const parts: MapPart[] = [];
  regions.forEach((r, i) => {
    let id = byRoot.get(r.part);
    if (id === undefined) {
      byRoot.set(r.part, (id = parts.length));
      parts.push({
        id,
        name: '',
        regions: [],
        area: 0,
        thickness: 0,
        centroid: [0, 0, 0],
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      });
    }
    const part = parts[id];
    part.regions.push(i);
    part.thickness = (part.thickness * part.area + Math.log2(r.thickness) * r.area) / (part.area + r.area);
    for (let k = 0; k < 3; k++) part.centroid[k] = (part.centroid[k] * part.area + r.centroid[k] * r.area) / (part.area + r.area);
    part.area += r.area;
  });
  for (const r of regions) r.part = byRoot.get(r.part)!;
  for (const part of parts) part.thickness = 2 ** part.thickness;
  const { t, p } = topo;
  for (let f = 0; f < faceRegion.length; f++) {
    const part = parts[regions[faceRegion[f]].part];
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) {
        const v = p[t[f * 3 + j] * 3 + k];
        if (v < part.min[k]) part.min[k] = v;
        if (v > part.max[k]) part.max[k] = v;
      }
  }
  // Largest part first (stable ids for the UI).
  parts.sort((a, b) => b.area - a.area);
  const remap = new Map(parts.map((q, i) => [q.id, i]));
  parts.forEach((q, i) => (q.id = i));
  for (const r of regions) r.part = remap.get(r.part)!;
  return parts;
}

/**
 * Readable names from where each part sits (Z up, as printed; front = −Y, the default view).
 * A hint only: the user renames freely.
 */
function nameParts(parts: MapPart[], g: RegionGraph, regions: PartRegion[], lo: Vec3, hi: Vec3) {
  const H = hi[2] - lo[2] || 1;
  const W = Math.max(hi[0] - lo[0], hi[1] - lo[1]) || 1;
  // Part adjacency from region borders.
  const adj = parts.map(() => new Map<number, number>());
  for (let a = 0; a < g.count; a++)
    for (const [b, e] of g.borders[a]) {
      const pa = regions[a].part, pb = regions[b].part;
      if (pa !== pb) adj[pa].set(pb, (adj[pa].get(pb) ?? 0) + e.length / 2);
    }
  const named = new Set<number>();
  const set = (q: MapPart, name: string) => {
    q.name = name;
    named.add(q.id);
  };
  // Base: touches the floor and is wider than tall.
  for (const q of parts) {
    const w = Math.max(q.max[0] - q.min[0], q.max[1] - q.min[1]), h = q.max[2] - q.min[2];
    if (q.min[2] - lo[2] < H * 0.02 && w > h * 2.5 && w > W * 0.5) set(q, 'Base');
  }
  // Legs reach the floor; the torso is the big part they hang from (most neighbours otherwise,
  // e.g. a bust).
  const total = parts.reduce((s, x) => s + x.area, 0);
  const floor = (q: MapPart) => q.min[2] - lo[2] < H * 0.12;
  const big = parts.filter((q) => !named.has(q.id) && !floor(q) && q.area > total * 0.03);
  const legsOf = (q: MapPart) => parts.filter((x) => !named.has(x.id) && floor(x) && adj[q.id].has(x.id)).length;
  const torso = big.sort((a, b) => legsOf(b) - legsOf(a) || adj[b.id].size - adj[a.id].size || b.area - a.area)[0];
  if (torso) set(torso, 'Tronco');
  const tz = torso ? torso.centroid[2] : lo[2] + H / 2;
  const tx = torso ? torso.centroid[0] : (lo[0] + hi[0]) / 2;
  const halfWidth = torso ? (torso.max[0] - torso.min[0]) / 2 : W / 2;
  const side = (q: MapPart) => (q.centroid[0] > tx ? 'esquerdo' : 'direito');
  const sideF = (q: MapPart) => (q.centroid[0] > tx ? 'esquerda' : 'direita');
  // Head: the biggest neighbour of the torso sitting above it; a part on top of the head is a hat.
  const head = parts
    .filter((q) => !named.has(q.id) && torso && adj[q.id].has(torso.id) && q.centroid[2] > torso.max[2] - (torso.max[2] - torso.min[2]) * 0.2)
    .sort((a, b) => b.area - a.area)[0];
  if (head) {
    set(head, 'Cabeça');
    for (const q of parts) if (!named.has(q.id) && adj[q.id].has(head.id) && q.centroid[2] > head.centroid[2]) set(q, 'Chapéu');
  }
  for (const q of parts) {
    if (named.has(q.id)) continue;
    const touchesTorso = torso && adj[q.id].has(torso.id);
    const elong = (q.max[2] - q.min[2]) / Math.max(1e-6, Math.max(q.max[0] - q.min[0], q.max[1] - q.min[1]));
    if (touchesTorso && floor(q)) set(q, `Perna ${sideF(q)}`);
    // Arms hang beside the torso (a scarf or a collar sits in front of it).
    else if (touchesTorso && q.max[2] > tz && Math.abs(q.centroid[0] - tx) > halfWidth * 0.4) set(q, `Braço ${side(q)}`);
    else if (q.thickness < (torso?.thickness ?? Infinity) * 0.35 && Math.max(elong, 1 / elong) > 2.5) set(q, 'Acessório');
  }
  let n = 1;
  for (const q of parts) if (!named.has(q.id)) set(q, `Parte ${n++}`);
  // Disambiguate repeated names.
  const seen = new Map<string, number>();
  for (const q of parts) {
    const k = seen.get(q.name) ?? 0;
    seen.set(q.name, k + 1);
    if (k) q.name = `${q.name} ${k + 1}`;
  }
}
