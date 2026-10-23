import type { CrossSection, Manifold, Mat4 } from 'manifold-3d';
import { dot, normalize, sub, length } from './math';
import type { CutHint, Plane, SphereBounds, Vec3 } from './types';
import type { Wasm } from './wasm';

export interface CutResult {
  /** Negative side (opposite to the normal). */
  a: Manifold;
  /** Positive side (where the normal points). */
  b: Manifold;
}

/**
 * Cut failure the user can act on. `hint` names the fix shown next to the message
 * (pre-validation banner and history card).
 */
export class CutError extends Error {
  constructor(message: string, readonly hint?: CutHint) {
    super(message);
  }
}

/** Which islands of the positive side become part B in a bounded cut. */
export interface IslandFilter {
  /** Sphere limiting the cut face (kept as an optional filter). */
  bounded?: SphereBounds;
  /** Points that must end up in B (SmartCut seeds, or a click "this piece goes to B"). */
  keep?: Vec3[];
  /** Points that must stay in A. */
  avoid?: Vec3[];
  /** A vertex "touches" the cut when this returns true (plane distance or profile band). */
  touches: (p: Vec3) => boolean;
}

/** Tolerance for "this vertex lies on the cut": float32 rounding grows with coordinates. */
export function cutTolerance(part: Manifold, offset = 0) {
  const box = part.boundingBox();
  const diag = length(sub(box.max, box.min));
  const far = Math.max(...box.min.map(Math.abs), ...box.max.map(Math.abs), Math.abs(offset));
  return Math.max(diag * 1e-4, far * 4e-6, 1e-5);
}

/** Squared distance from p to triangle abc (Ericson, "Real-Time Collision Detection" 5.1.5). */
export function pointTriangleDist2(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const sq = (q: Vec3) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  if (d1 <= 0 && d2 <= 0) return sq(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return sq(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return sq([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]);
  }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return sq(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return sq([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return sq([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return sq([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

/** Distance from `p` to the surface of a mesh (brute force: seeds are few). */
function surfaceDistance(vp: Float32Array, tv: Uint32Array, np: number, p: Vec3) {
  let best = Infinity;
  const at = (i: number): Vec3 => [vp[i * np], vp[i * np + 1], vp[i * np + 2]];
  for (let f = 0; f < tv.length; f += 3) {
    const d = pointTriangleDist2(p, at(tv[f]), at(tv[f + 1]), at(tv[f + 2]));
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Does `p` lie inside (or on) this closed island? Ray parity on its triangles. */
function contains(mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }, p: Vec3) {
  const { vertProperties: v, triVerts: t, numProp: np } = mesh;
  // Slightly irrational direction avoids hitting edges exactly.
  const d: Vec3 = normalize([0.5773, 0.5774, 0.5775 + 1e-3]);
  let hits = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * np, b = t[f + 1] * np, c = t[f + 2] * np;
    const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
    const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const sx = p[0] - v[a], sy = p[1] - v[a + 1], sz = p[2] - v[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (w < 0 || u + w > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) hits++;
  }
  return hits % 2 === 1;
}

/**
 * Owner test for a seed: the seed lies on (or within `slack` of) the island surface, or inside it.
 * Seeds come from surface hits, so the distance test is the common case.
 */
export function islandOwns(c: Manifold, p: Vec3, slack: number) {
  const mesh = c.getMesh();
  const box = c.boundingBox();
  if ([0, 1, 2].some((k) => p[k] < box.min[k] - slack || p[k] > box.max[k] + slack)) return false;
  if (surfaceDistance(mesh.vertProperties, mesh.triVerts, mesh.numProp, p) <= slack) return true;
  return contains(mesh, p);
}

/**
 * Splits the positive side of a cut into islands and decides which go to B.
 * Rules, in order: islands owning a `keep` point go to B; islands owning an `avoid` point
 * stay in A; with a sphere, an island goes to B when most of its cut face lies inside it.
 * Islands that stay are re-joined to A (they never vanish).
 */
export function selectIslands(wasm: Wasm, part: Manifold, pos: Manifold, neg: Manifold, filter: IslandFilter): CutResult {
  const components = pos.decompose();
  const sliver = Math.abs(part.volume()) * 1e-6;
  const box = part.boundingBox();
  const slack = Math.max(length(sub(box.max, box.min)) * 0.01, 0.5);
  const islands: Manifold[] = [];
  const rest: Manifold[] = [];
  const hasKeep = !!filter.keep?.length;
  for (const c of components) {
    if (Math.abs(c.volume()) <= sliver) {
      rest.push(c);
      continue;
    }
    if (filter.avoid?.some((p) => islandOwns(c, p, slack * 0.25))) {
      rest.push(c);
      continue;
    }
    if (hasKeep) {
      (filter.keep!.some((p) => islandOwns(c, p, slack)) ? islands : rest).push(c);
      continue;
    }
    if (!filter.bounded) {
      islands.push(c);
      continue;
    }
    const mesh = c.getMesh();
    const vp = mesh.vertProperties;
    const np = mesh.numProp;
    let touching = 0, inside = 0;
    for (let i = 0; i < vp.length; i += np) {
      const p: Vec3 = [vp[i], vp[i + 1], vp[i + 2]];
      if (!filter.touches(p)) continue;
      touching++;
      if (length(sub(p, filter.bounded.center)) <= filter.bounded.radius) inside++;
    }
    // Majority rule: a plane that also grazes a shoulder or a strand of hair inside the
    // same island no longer rejects it (the old "every vertex inside" rule did).
    if (touching > 0 && inside / touching >= 0.5) islands.push(c);
    else rest.push(c);
  }

  if (islands.length === 0) {
    components.forEach((c) => c.delete());
    pos.delete();
    neg.delete();
    if (hasKeep) throw new CutError('O corte não separa a região marcada: ela continua presa ao resto da peça.', 'use-region');
    throw new CutError('Nenhuma ilha separável dentro do limite. Aumente o raio ou mova o plano.', 'grow-radius');
  }
  if (rest.length === 0) {
    components.forEach((c) => c.delete());
    return { a: neg, b: pos };
  }

  const b = wasm.Manifold.compose(islands);
  const a = dropSlivers(wasm, wasm.Manifold.union([neg, ...rest]));
  components.forEach((c) => c.delete());
  pos.delete();
  neg.delete();
  return { a, b };
}

/**
 * Splits a solid by a plane. Both results are closed manifolds.
 * With `bounded` (sphere) and/or `keep` points, only some islands of the positive side are
 * separated; everything else stays in `a`.
 */
export function cutByPlane(wasm: Wasm, part: Manifold, plane: Plane, bounded?: SphereBounds, keep?: Vec3[]): CutResult {
  const n = normalize(plane.normal);
  const offset = dot(n, plane.origin);
  const [pos, neg] = part.splitByPlane(n, offset);
  const minVolume = Math.abs(part.volume()) * 1e-7;
  if (pos.isEmpty() || neg.isEmpty() || pos.volume() < minVolume || neg.volume() < minVolume) {
    pos.delete();
    neg.delete();
    throw new CutError('O plano não atravessa a peça.', 'move-plane');
  }
  if (!bounded && !keep?.length) return { a: neg, b: pos };
  const eps = cutTolerance(part, offset);
  return selectIslands(wasm, part, pos, neg, { bounded, keep, touches: (p) => Math.abs(dot(n, p) - offset) <= eps });
}

/** Cheap dry-run of a plane cut: does it cross the part, and into how many islands? */
export function planeCutIslands(part: Manifold, plane: Plane): { crosses: boolean; islandsB: number; islandsA: number } {
  const n = normalize(plane.normal);
  const [pos, neg] = part.splitByPlane(n, dot(n, plane.origin));
  const minVolume = Math.abs(part.volume()) * 1e-7;
  const crosses = !pos.isEmpty() && !neg.isEmpty() && pos.volume() >= minVolume && neg.volume() >= minVolume;
  const count = (m: Manifold) => {
    if (m.isEmpty()) return 0;
    const parts = m.decompose();
    const k = parts.filter((p) => Math.abs(p.volume()) >= minVolume).length;
    parts.forEach((p) => p.delete());
    return k;
  };
  const res = { crosses, islandsB: crosses ? count(pos) : 0, islandsA: crosses ? count(neg) : 0 };
  pos.delete();
  neg.delete();
  return res;
}

/**
 * Re-joining split halves along an oblique plane can leave zero-volume shells
 * (float rounding on the shared face). Drop them so parts stay single solids.
 */
export function dropSlivers(wasm: Wasm, m: Manifold): Manifold {
  const comps = m.decompose();
  const total = Math.abs(m.volume());
  // |volume|: an internal void is a legit component with negative volume (e.g. resin hollowing).
  const keep = comps.filter((c) => Math.abs(c.volume()) > total * 1e-6);
  if (keep.length === comps.length) {
    comps.forEach((c) => c.delete());
    return m;
  }
  const out = wasm.Manifold.compose(keep);
  comps.forEach((c) => c.delete());
  m.delete();
  return out;
}

/**
 * Cut face of `b` on the plane: its bottom faces in plane-local space (z = 0).
 * `faceRadius` keeps only the disc of that radius around the plane origin (flat centre of a
 * curved SmartCut joint); there the face sits exactly at z = 0.
 */
export function faceSection(b: Manifold, toLocal: Mat4, faceRadius?: number, wasm?: Wasm): CrossSection {
  const local = b.transform(toLocal);
  // After the transform the face sits at z ≈ 0 ± rounding; slicing exactly there can
  // miss it. Slice 1 µm above the part's actual bottom instead.
  const z = faceRadius && wasm ? 1e-3 : local.boundingBox().min[2] + 1e-3;
  const section = local.slice(z);
  local.delete();
  if (!faceRadius || !wasm) return section;
  const disc = wasm.CrossSection.circle(faceRadius, 64);
  const clipped = section.intersect(disc);
  section.delete();
  disc.delete();
  return clipped;
}
