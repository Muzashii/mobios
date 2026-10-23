import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { cutByPlane, CutError } from '../../src/geometry/cut';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { normalize } from '../../src/geometry/math';
import type { Vec3 } from '../../src/geometry/types';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const unitVec = fc
  .tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }))
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 0.1)
  .map((v) => normalize(v as Vec3));
const point = fc.tuple(fc.double({ min: -6, max: 6, noNaN: true }), fc.double({ min: -6, max: 6, noNaN: true }), fc.double({ min: -6, max: 6, noNaN: true }));

describe('plane cut invariants', () => {
  it('every result is manifold and volumes are conserved', () => {
    const shapes = [
      () => wasm.Manifold.cube([16, 12, 20], true),
      () => wasm.Manifold.sphere(10, 48),
      () => wasm.Manifold.cylinder(20, 8, 4, 40, true).subtract(wasm.Manifold.cube([4, 4, 30], true)),
    ];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: shapes.length - 1 }), unitVec, point, (s, normal, origin) => {
        const solid = shapes[s]();
        try {
          const { a, b } = cutByPlane(wasm, solid, { origin: origin as Vec3, normal });
          expect(a.status()).toBe('NoError');
          expect(b.status()).toBe('NoError');
          expect(a.volume()).toBeGreaterThan(0);
          expect(b.volume()).toBeGreaterThan(0);
          expect(Math.abs(a.volume() + b.volume() - solid.volume())).toBeLessThan(solid.volume() * 1e-6 + 1e-6);
          a.delete();
          b.delete();
        } catch (e) {
          // Plane outside the solid is a legitimate, reported outcome.
          expect(e).toBeInstanceOf(CutError);
        } finally {
          solid.delete();
        }
      }),
      { numRuns: 120 },
    );
  });
});
