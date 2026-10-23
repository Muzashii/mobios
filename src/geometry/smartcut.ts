import type { Manifold } from 'manifold-3d';
import { manifoldToMeshData } from './repair';
import { boundaryLoops, fitPlane, labelFaces, LoopError, makeContext, regionField, regionKind, scanLevels, seedBalls, type RegionContext } from './segment/region';
import type { MeshData, SmartCutCandidate, SmartCutSuggestion, Vec3 } from './types';

export { smallestEigenvector, clusterSeeds } from './segment/region';

/**
 * SmartCut v2 — suggests where to separate the region around the seeds from the rest.
 * See segment/region.ts for the pipeline (SDF balls → geodesic rings → min-cut snapping).
 * Returns up to three candidates (Tab cycles in the UI); the cut itself is a `cut-region`
 * operation that follows the ring exactly instead of flattening it into a plane.
 */
export interface SuggestOptions {
  negSeeds?: Vec3[];
  maxCandidates?: number;
}

/** Band (mm) around a level inside which the min-cut may move the ring. */
export const snapBand = (ctx: RegionContext, level: number) => Math.max(ctx.edge * 2, Math.min(level * 0.35, ctx.diag * 0.05));

export function suggestRegion(ctx: RegionContext, seeds: Vec3[], seedRadius: number, opts: SuggestOptions = {}): SmartCutSuggestion {
  if (!seeds.length || ctx.topo.nf === 0) throw new Error('Pincele ou clique na região que quer separar.');
  const balls = seedBalls(ctx, seeds, seedRadius);
  const field = regionField(ctx, balls, seeds, opts.negSeeds);
  const levels = scanLevels(ctx, field, opts.maxCandidates ?? 3);
  const candidates: SmartCutCandidate[] = [];
  for (const lv of levels) {
    const labels = labelFaces(ctx, field, lv.t, snapBand(ctx, lv.t));
    let loopsIdx: number[][];
    try {
      loopsIdx = boundaryLoops(ctx.topo, labels);
    } catch (e) {
      if (e instanceof LoopError) continue;
      throw e;
    }
    if (!loopsIdx.length) continue;
    const p = ctx.topo.p;
    const loops = loopsIdx.map((l) => l.map((v): Vec3 => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]));
    const main = loops.reduce((x, y) => (y.length > x.length ? y : x));
    const fit = fitPlane(main, field.centroid);
    let perimeter = 0;
    for (let i = 0; i < main.length; i++) {
      const a = main[i], b = main[(i + 1) % main.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    let areaB = 0;
    for (let f = 0; f < ctx.topo.nf; f++) if (labels[f]) areaB += ctx.topo.fArea[f];
    candidates.push({
      level: lv.t,
      plane: fit.plane,
      radius: fit.radius,
      loops,
      perimeter,
      planarity: fit.planarity,
      confidence: Math.max(0, Math.min(1, 1 - lv.score / 1.15)),
      kind: regionKind(ctx.topo, labels),
      areaShare: areaB / ctx.topo.totalArea,
      preview: soup(ctx, labels),
      name: guessName(ctx, labels),
    });
  }
  if (!candidates.length) throw new Error('Não encontrei um contorno fechado para separar. Pincele mais da região (ex.: o braço inteiro).');
  const best = candidates[0];
  const { origin, normal } = best.plane;
  // Plane-cut fallback: step slightly onto the limb so the plane does not graze the body.
  const step = Math.min(best.radius * 0.15, 2);
  return {
    plane: { origin: [origin[0] + normal[0] * step, origin[1] + normal[1] * step, origin[2] + normal[2] * step], normal },
    radius: best.radius * 1.35 + 1,
    ring: best.loops.flat(),
    perimeter: best.perimeter,
    confidence: best.confidence,
    balls,
    seeds,
    candidates,
  };
}

/** Convenience for tests and one-off calls (builds the analysis context). */
export function suggestSmartCut(mesh: MeshData, seeds: Vec3[], seedRadius: number, opts?: SuggestOptions): SmartCutSuggestion {
  const ctx = makeContext(mesh);
  try {
    return suggestRegion(ctx, seeds, seedRadius, opts);
  } finally {
    ctx.query.dispose();
  }
}

/** B side of a labelling as a triangle soup (for highlighting in the viewport). */
function soup(ctx: RegionContext, labels: Uint8Array): Float32Array {
  const { t, p, nf } = ctx.topo;
  let n = 0;
  for (let f = 0; f < nf; f++) if (labels[f]) n++;
  const out = new Float32Array(n * 9);
  let o = 0;
  for (let f = 0; f < nf; f++) {
    if (!labels[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = t[f * 3 + k] * 3;
      out[o++] = p[v]; out[o++] = p[v + 1]; out[o++] = p[v + 2];
    }
  }
  return out;
}

/**
 * Name for part B from where it sits on the figure (Z up, as printed). A hint only — the user
 * renames parts freely.
 */
export function guessName(ctx: RegionContext, labels: Uint8Array): string {
  const { t, p, nf } = ctx.topo;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const blo = [Infinity, Infinity, Infinity], bhi = [-Infinity, -Infinity, -Infinity];
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
    const v = t[f * 3 + k] * 3;
    for (let j = 0; j < 3; j++) {
      lo[j] = Math.min(lo[j], p[v + j]); hi[j] = Math.max(hi[j], p[v + j]);
      if (labels[f]) { blo[j] = Math.min(blo[j], p[v + j]); bhi[j] = Math.max(bhi[j], p[v + j]); }
    }
  }
  const H = hi[2] - lo[2] || 1;
  const W = Math.max(hi[0] - lo[0], hi[1] - lo[1]) || 1;
  const bottom = (blo[2] - lo[2]) / H, top = (bhi[2] - lo[2]) / H;
  const bc = [(blo[0] + bhi[0]) / 2, (blo[1] + bhi[1]) / 2];
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
  const lateral = Math.hypot(bc[0] - c[0], bc[1] - c[1]) / W;
  const width = Math.max(bhi[0] - blo[0], bhi[1] - blo[1]) / W;
  if (bottom > 0.68 && top > 0.95 && width < 0.7) return 'Cabeça';
  if (top < 0.14) return 'Pé';
  if (top < 0.5 && lateral > 0.05) return 'Perna';
  if (bottom > 0.3 && lateral > 0.22) return 'Braço';
  return 'Parte';
}

/** Sorted distances of every triangle crossing along a ray (Möller–Trumbore, brute force). */
export function rayHits(p: Float32Array, t: Uint32Array, o: Vec3, d: Vec3): number[] {
  const hits: number[] = [];
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = o[0] - p[a], sy = o[1] - p[a + 1], sz = o[2] - p[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-6) hits.push(dist);
  }
  return hits.sort((x, y) => x - y);
}

/**
 * Analysis contexts per manifold (LRU). `suggest` meshes are a ≤ 300k-triangle proxy for
 * speed; `apply` meshes are the part itself, refined only when its triangles are so long that
 * geodesic rings would be jagged (CAD exports). Building one costs a BVH + topology, so hover
 * and repeated suggestions on the same part reuse it.
 */
const caches = { suggest: new Map<Manifold, RegionContext>(), apply: new Map<Manifold, RegionContext>() };

export function regionContext(m: Manifold, purpose: 'suggest' | 'apply'): RegionContext {
  const cache = caches[purpose];
  const hit = cache.get(m);
  if (hit) {
    cache.delete(m);
    cache.set(m, hit);
    return hit;
  }
  const box = m.boundingBox();
  const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  let work: Manifold = m;
  if (purpose === 'suggest' && m.numTri() > 300_000) {
    for (let tol = diag * 5e-4; tol < diag * 0.05; tol *= 2) {
      const s = m.simplify(tol);
      if (work !== m) work.delete();
      work = s;
      if (s.numTri() <= 300_000) break;
    }
  } else if (m.numTri() < 150_000 && maxEdge(m) > diag / 40) {
    work = m.refineToLength(diag / 120);
  }
  const mesh = manifoldToMeshData(work);
  if (work !== m) work.delete();
  const ctx = makeContext(mesh);
  cache.set(m, ctx);
  while (cache.size > 6) {
    const [k, v] = cache.entries().next().value as [Manifold, RegionContext];
    v.query.dispose();
    cache.delete(k);
  }
  return ctx;
}

/** Drops cached contexts (worker reset, tests). */
export function clearRegionContexts() {
  for (const cache of Object.values(caches)) {
    for (const v of cache.values()) v.query.dispose();
    cache.clear();
  }
}

function maxEdge(m: Manifold) {
  const mesh = m.getMesh();
  const { vertProperties: v, triVerts: t, numProp: np } = mesh;
  let best = 0;
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = t[i + k] * np, b = t[i + (k + 1) % 3] * np;
    best = Math.max(best, (v[a] - v[b]) ** 2 + (v[a + 1] - v[b + 1]) ** 2 + (v[a + 2] - v[b + 2]) ** 2);
  }
  return Math.sqrt(best);
}
