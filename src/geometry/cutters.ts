import type { Manifold, Mat4 } from 'manifold-3d';
import { CutError, cutTolerance, dropSlivers, selectIslands, type CutResult } from './cut';
import { cross, dot, length, normalize, planeFrame, sub } from './math';
import type { CutProfile, Plane, SphereBounds, StrokeFrame, Vec2, Vec3 } from './types';
import type { Wasm } from './wasm';

/**
 * Cuts with an arbitrary solid "cutter": B = part ∩ cutter, A = part − cutter.
 * Used for profiled and free-hand cuts (the cutter never shares faces with the part,
 * so the booleans stay robust).
 */
export function cutByCutter(wasm: Wasm, part: Manifold, cutter: Manifold): CutResult {
  const b = dropSlivers(wasm, part.intersect(cutter));
  const a = dropSlivers(wasm, part.subtract(cutter));
  const minVolume = Math.abs(part.volume()) * 1e-7;
  if (a.isEmpty() || b.isEmpty() || a.volume() < minVolume || b.volume() < minVolume) {
    a.delete();
    b.delete();
    throw new CutError('A superfície de corte não atravessa a peça.', 'move-plane');
  }
  return { a, b };
}

/**
 * Profiled cut limited to the islands whose (profiled) cut face lies mostly inside the sphere:
 * the profile is cut everywhere, then the islands outside the limit are re-joined to A.
 */
export function boundedProfileCut(wasm: Wasm, part: Manifold, plane: Plane, profile: CutProfile, bounded: SphereBounds | undefined, keep?: Vec3[]): CutResult {
  const cutter = profileCutter(wasm, plane, profile, cutterReach(part));
  const res = cutByCutter(wasm, part, cutter);
  cutter.delete();
  if (!bounded && !keep?.length) return res;
  const n = normalize(plane.normal);
  const offset = dot(n, plane.origin);
  // Vertices of the profiled face sit within half the amplitude of the mid plane.
  const band = profile.amplitude / 2 + cutTolerance(part, offset);
  return selectIslands(wasm, part, res.b, res.a, { bounded, keep, touches: (p) => Math.abs(dot(n, p) - offset) <= band });
}

/** Half-extent of a cutter that safely covers the whole part. */
export function cutterReach(part: Manifold) {
  const box = part.boundingBox();
  return length(sub(box.max, box.min)) * 1.5 + 10;
}

/** Height of the profile at x (mm), centred so the plane passes through the middle. */
export function profileHeight(p: CutProfile, x: number): number {
  const a = p.amplitude;
  const period = Math.max(p.period, 0.5);
  switch (p.kind) {
    case 'step':
      return x < 0 ? -a / 2 : a / 2;
    case 'zigzag': {
      const t = (((x / period) % 1) + 1) % 1; // 0..1
      return a * (t < 0.5 ? t * 2 - 0.5 : 1.5 - t * 2);
    }
    case 'wave':
      return (a / 2) * Math.sin((2 * Math.PI * x) / period);
  }
}

/**
 * Solid above a profiled plane: in plane coordinates (x along u, y along the normal)
 * it fills y > f(x), extruded across v.
 */
export function profileCutter(wasm: Wasm, plane: Plane, profile: CutProfile, reach: number): Manifold {
  const L = reach;
  const pts: Vec2[] = [];
  if (profile.kind === 'step') {
    pts.push([-L, -profile.amplitude / 2], [0, -profile.amplitude / 2], [0, profile.amplitude / 2], [L, profile.amplitude / 2]);
  } else {
    const period = Math.max(profile.period, 0.5);
    const step = profile.kind === 'zigzag' ? period / 2 : period / 24;
    // Sample from -L to L; zigzag samples land exactly on the corners.
    const start = Math.floor(-L / step) * step;
    for (let x = start; x <= L + step; x += step) pts.push([x, profileHeight(profile, x)]);
  }
  const first = pts[0][0], last = pts[pts.length - 1][0];
  pts.push([last, L], [first, L]);
  const cs = new wasm.CrossSection([pts], 'NonZero');
  const slab = cs.extrude(2 * L, 0, 0, [1, 1], true);
  cs.delete();
  // Local (x, y, z) → world: x·u + y·n + z·(−v) keeps a right-handed basis.
  const { u, v, n, origin } = planeFrame(plane);
  const m: Mat4 = [u[0], u[1], u[2], 0, n[0], n[1], n[2], 0, -v[0], -v[1], -v[2], 0, origin[0], origin[1], origin[2], 1];
  const out = slab.transform(m);
  slab.delete();
  return out;
}

/** Smooths and resamples a free-hand stroke (Chaikin), dropping near-duplicate points. */
export function smoothStroke(points: Vec2[], iterations = 2, minStep = 0.5): Vec2[] {
  let pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) >= minStep);
  for (let k = 0; k < iterations && pts.length > 2; k++) {
    const out: Vec2[] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Region to the left of a stroke (as drawn), extruded along the view direction.
 * The stroke is extended at both ends so it always crosses the whole part.
 * With `frame.eye` (perspective camera) the region is swept along the camera rays instead,
 * so the cut lands exactly under the drawn line everywhere on screen.
 */
export function strokeCutter(wasm: Wasm, frame: StrokeFrame, stroke: Vec2[], reach: number): Manifold {
  if (stroke.length < 2) throw new CutError('Desenhe um traço que atravesse a peça.');
  const n = normalize(frame.n);
  const u = normalize(frame.u);
  const v = cross(n, u);
  const o: Vec3 = frame.origin;
  const eye = frame.eye;
  const depth = eye ? dot(sub(eye, o), n) : 0;
  if (eye && depth > 1e-3) return perspectiveCutter(wasm, frame, stroke, reach, { u, v, n, depth });

  const poly = leftRegion(stroke, reach);
  // Orientation-agnostic: NonZero fill keeps the enclosed side regardless of winding.
  const cs = new wasm.CrossSection([poly], 'NonZero');
  if (cs.isEmpty()) {
    cs.delete();
    throw new CutError('Traço inválido para corte.');
  }
  const L = reach;
  const slab = cs.extrude(2 * L, 0, 0, [1, 1], true);
  cs.delete();
  const m: Mat4 = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1];
  const out = slab.transform(m);
  slab.delete();
  return out;
}

/** Polygon covering the left side of a stroke, extended by `L` past both ends. */
function leftRegion(stroke: Vec2[], L: number): Vec2[] {
  const dir = (a: Vec2, b: Vec2): Vec2 => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  const d0 = dir(stroke[1], stroke[0]);
  const d1 = dir(stroke[stroke.length - 2], stroke[stroke.length - 1]);
  const start: Vec2 = [stroke[0][0] + d0[0] * L, stroke[0][1] + d0[1] * L];
  const end: Vec2 = [stroke[stroke.length - 1][0] + d1[0] * L, stroke[stroke.length - 1][1] + d1[1] * L];
  // Left normal of the travel direction (start → end).
  const left = (d: Vec2): Vec2 => [-d[1], d[0]];
  const lEnd = left(d1);
  const lStart = left([-d0[0], -d0[1]]);
  return [
    start,
    ...stroke,
    end,
    [end[0] + lEnd[0] * L * 2, end[1] + lEnd[1] * L * 2],
    [start[0] + lStart[0] * L * 2, start[1] + lStart[1] * L * 2],
  ];
}

/**
 * Perspective sweep: every point of the stroke (drawn on the plane through `origin`) is
 * moved along its camera ray. A point at height h above the plane (towards the eye) sits at
 * λ = 1 − h / depth of the way from the eye's foot point, so the cross-section scales linearly
 * with h — exactly what `extrude(…, scaleTop)` builds.
 */
function perspectiveCutter(wasm: Wasm, frame: StrokeFrame, stroke: Vec2[], reach: number, f: { u: Vec3; v: Vec3; n: Vec3; depth: number }): Manifold {
  const { u, v, n, depth } = f;
  const rel = sub(frame.eye!, frame.origin);
  const e: Vec2 = [dot(rel, u), dot(rel, v)];
  // From just in front of the eye (or `reach` above the plane) down to `reach` behind it.
  const zTop = Math.min(reach, depth * 0.98);
  const zBottom = -reach;
  const lTop = 1 - zTop / depth, lBottom = 1 - zBottom / depth;
  // The 2D region must still cover the part where it is smallest (near the eye).
  const poly = leftRegion(stroke, (reach * 2) / lTop).map(([x, y]): Vec2 => [(x - e[0]) * lBottom, (y - e[1]) * lBottom]);
  const cs = new wasm.CrossSection([poly], 'NonZero');
  if (cs.isEmpty()) {
    cs.delete();
    throw new CutError('Traço inválido para corte.');
  }
  // Extrude from the far end (z = zBottom, scale 1) towards the eye (scale lTop / lBottom).
  const s = lTop / lBottom;
  const cone = cs.extrude(zTop - zBottom, 0, 0, [s, s]);
  cs.delete();
  // Local x, y in the (u, v) plane centred under the eye; local z runs along +n from zBottom.
  const o = frame.origin;
  const base: Vec3 = [0, 1, 2].map((k) => o[k] + u[k] * e[0] + v[k] * e[1] + n[k] * zBottom) as Vec3;
  const m: Mat4 = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, base[0], base[1], base[2], 1];
  const out = cone.transform(m);
  cone.delete();
  return out;
}
