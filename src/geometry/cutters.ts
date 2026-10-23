import type { Manifold, Mat4 } from 'manifold-3d';
import { CutError, dropSlivers, type CutResult } from './cut';
import { cross, length, normalize, planeFrame, sub } from './math';
import type { CutProfile, Plane, StrokeFrame, Vec2, Vec3 } from './types';
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
    throw new CutError('A superfície de corte não atravessa a peça.');
  }
  return { a, b };
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
 */
export function strokeCutter(wasm: Wasm, frame: StrokeFrame, stroke: Vec2[], reach: number): Manifold {
  if (stroke.length < 2) throw new CutError('Desenhe um traço que atravesse a peça.');
  const L = reach;
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
  const poly: Vec2[] = [
    start,
    ...stroke,
    end,
    [end[0] + lEnd[0] * L * 2, end[1] + lEnd[1] * L * 2],
    [start[0] + lStart[0] * L * 2, start[1] + lStart[1] * L * 2],
  ];
  // Orientation-agnostic: NonZero fill keeps the enclosed side regardless of winding.
  const cs = new wasm.CrossSection([poly], 'NonZero');
  if (cs.isEmpty()) {
    cs.delete();
    throw new CutError('Traço inválido para corte.');
  }
  const slab = cs.extrude(2 * L, 0, 0, [1, 1], true);
  cs.delete();
  const n = normalize(frame.n);
  const u = normalize(frame.u);
  const v = cross(n, u);
  const o: Vec3 = frame.origin;
  const m: Mat4 = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1];
  const out = slab.transform(m);
  slab.delete();
  return out;
}
