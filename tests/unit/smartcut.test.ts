import { beforeAll, describe, expect, it } from 'vitest';
import { cutByPlane } from '../../src/geometry/cut';
import { manifoldToMeshData } from '../../src/geometry/repair';
import { smallestEigenvector, suggestSmartCut } from '../../src/geometry/smartcut';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { GeometryService } from '../../src/geometry/service';
import { FIGURES } from '../fixtures/figures';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

describe('smallestEigenvector', () => {
  it('finds the flat direction of a disc of points', () => {
    const e = smallestEigenvector([10, 0, 0, 0, 7, 0, 0, 0, 0.1]);
    expect(Math.abs(e[2])).toBeCloseTo(1, 6);
    const r = smallestEigenvector([5, 4, 0, 4, 5, 0, 0, 0, 9]); // smallest: (1,-1,0)/√2
    expect(Math.abs(r[0] + r[1])).toBeLessThan(1e-6);
  });
});

describe('SmartCut — 5 figuras de teste (critério da Fase 5)', () => {
  for (const fig of FIGURES) {
    it(fig.name, () => {
      const solid = fig.build(wasm);
      const s = new GeometryService(wasm).smartCutOn(solid, fig.seeds, fig.seedRadius);
      const o = s.plane.origin;
      const off = Math.hypot(o[0] - fig.joint[0], o[1] - fig.joint[1], o[2] - fig.joint[2]);
      const align = Math.abs(s.plane.normal[0] * fig.axis[0] + s.plane.normal[1] * fig.axis[1] + s.plane.normal[2] * fig.axis[2]);
      expect(off, `origem ${o.map((v) => v.toFixed(1))} longe da articulação`).toBeLessThan(fig.tolerance);
      expect(align).toBeGreaterThan(0.8);

      // The suggestion must be directly usable: a bounded cut that keeps the seed in B.
      const { a, b } = cutByPlane(wasm, solid, s.plane, { center: s.plane.origin, radius: s.radius });
      const seed = fig.seeds[fig.seeds.length - 1];
      const bb = b.boundingBox();
      const inside = [0, 1, 2].every((k) => seed[k] >= bb.min[k] - fig.seedRadius && seed[k] <= bb.max[k] + fig.seedRadius);
      expect(inside).toBe(true);
      expect(b.volume()).toBeGreaterThan(0);
      [solid, a, b].forEach((m) => m.delete());
    });
  }

  it('one-sided stroke on the front of the arm still cuts across it (regression from the UI)', () => {
    const fig = FIGURES[0];
    const solid = fig.build(wasm);
    // Three dabs on the visible (−Y) side of the forearm, as a quick drag in the viewport makes.
    const seeds = [0.55, 0.7, 0.85].map((t) => [17 + 17 * t, -5.2, 76 - 24 * t] as [number, number, number]);
    const s = new GeometryService(wasm).smartCutOn(solid, seeds, 4);
    const align = Math.abs(s.plane.normal[0] * fig.axis[0] + s.plane.normal[2] * fig.axis[2]);
    expect(align).toBeGreaterThan(0.8);
    expect(s.perimeter).toBeLessThan(50); // a ring around the arm, not along it
    solid.delete();
  });

  it('explains when there is no joint to find', () => {
    const cube = wasm.Manifold.cube([20, 20, 20], true);
    expect(() => suggestSmartCut(manifoldToMeshData(cube), [[0, 0, 0]], 100)).toThrow();
    cube.delete();
  });
});
