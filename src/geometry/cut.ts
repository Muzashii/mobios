import type { CrossSection, Manifold, Mat4 } from 'manifold-3d';
import { dot, normalize, sub, length } from './math';
import type { Plane, SphereBounds } from './types';
import type { Wasm } from './wasm';

export interface CutResult {
  /** Negative side (opposite to the normal). */
  a: Manifold;
  /** Positive side (where the normal points). */
  b: Manifold;
}

export class CutError extends Error {}

/**
 * Splits a solid by a plane. Both results are closed manifolds.
 * With `bounded`, only the islands on the positive side whose cut face lies
 * entirely inside the sphere are separated; everything else stays in `a`.
 */
export function cutByPlane(wasm: Wasm, part: Manifold, plane: Plane, bounded?: SphereBounds): CutResult {
  const n = normalize(plane.normal);
  const offset = dot(n, plane.origin);
  const [pos, neg] = part.splitByPlane(n, offset);
  const minVolume = Math.abs(part.volume()) * 1e-7;
  if (pos.isEmpty() || neg.isEmpty() || pos.volume() < minVolume || neg.volume() < minVolume) {
    pos.delete();
    neg.delete();
    throw new CutError('O plano não atravessa a peça.');
  }
  if (!bounded) return { a: neg, b: pos };

  const box = part.boundingBox();
  const eps = Math.max(length(sub(box.max, box.min)) * 1e-5, 1e-5);
  const components = pos.decompose();
  const islands: Manifold[] = [];
  const rest: Manifold[] = [];
  const sliver = Math.abs(part.volume()) * 1e-6;
  for (const c of components) {
    if (c.volume() <= sliver) {
      rest.push(c);
      continue;
    }
    const mesh = c.getMesh();
    const vp = mesh.vertProperties;
    const np = mesh.numProp;
    let touching = 0;
    let inside = true;
    for (let i = 0; i < vp.length; i += np) {
      const p: [number, number, number] = [vp[i], vp[i + 1], vp[i + 2]];
      if (Math.abs(dot(n, p) - offset) > eps) continue;
      touching++;
      if (length(sub(p, bounded.center)) > bounded.radius) {
        inside = false;
        break;
      }
    }
    if (touching > 0 && inside) islands.push(c);
    else rest.push(c);
  }

  if (islands.length === 0) {
    components.forEach((c) => c.delete());
    pos.delete();
    neg.delete();
    throw new CutError('Nenhuma ilha separável dentro do limite. Aumente o raio ou mova o plano.');
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
 * Re-joining split halves along an oblique plane can leave zero-volume shells
 * (float rounding on the shared face). Drop them so parts stay single solids.
 */
export function dropSlivers(wasm: Wasm, m: Manifold): Manifold {
  const comps = m.decompose();
  const total = Math.abs(m.volume());
  const keep = comps.filter((c) => c.volume() > total * 1e-6);
  if (keep.length === comps.length) {
    comps.forEach((c) => c.delete());
    return m;
  }
  const out = wasm.Manifold.compose(keep);
  comps.forEach((c) => c.delete());
  m.delete();
  return out;
}

/** Cut face of `b` on the plane: its bottom faces in plane-local space (z = 0). */
export function faceSection(b: Manifold, toLocal: Mat4): CrossSection {
  const local = b.transform(toLocal);
  // After the transform the face sits at z ≈ 0 ± rounding; slicing exactly there can
  // miss it. Slice 1 µm above the part's actual bottom instead.
  const section = local.slice(local.boundingBox().min[2] + 1e-3);
  local.delete();
  return section;
}
