import type { Wasm } from '../../src/geometry/wasm';

/** Sphere with ~500k triangles (SPEC §4 budget fixture). */
export function denseSphere(wasm: Wasm) {
  // Geodesic sphere: triangles = segments² / 2.
  return wasm.Manifold.sphere(60, 1000);
}
