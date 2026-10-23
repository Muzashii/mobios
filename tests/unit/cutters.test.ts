import { beforeAll, describe, expect, it } from 'vitest';
import { cutByCutter, profileCutter, profileHeight, smoothStroke, strokeCutter } from '../../src/geometry/cutters';
import { Engine } from '../../src/geometry/engine';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import type { CutProfile, Plane, StrokeFrame } from '../../src/geometry/types';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const plane: Plane = { origin: [0, 0, 0], normal: [0, 0, 1] };

describe('profiled cuts', () => {
  for (const kind of ['step', 'zigzag', 'wave'] as const) {
    it(`${kind}: conserves volume, keeps both halves closed, interlocks`, () => {
      const block = wasm.Manifold.cube([40, 30, 40], true);
      const profile: CutProfile = { kind, amplitude: 6, period: 10 };
      const cutter = profileCutter(wasm, plane, profile, 200);
      const { a, b } = cutByCutter(wasm, block, cutter);
      expect(a.status()).toBe('NoError');
      expect(b.status()).toBe('NoError');
      expect(a.volume() + b.volume()).toBeCloseTo(block.volume(), 1);
      expect(a.genus()).toBe(0);
      expect(b.genus()).toBe(0);
      // Non-flat joint: each half reaches past the mid plane.
      expect(a.boundingBox().max[2]).toBeGreaterThan(2);
      expect(b.boundingBox().min[2]).toBeLessThan(-2);
      // Joint surface is larger than the flat 40×30 section.
      const face = (a.surfaceArea() + b.surfaceArea() - block.surfaceArea()) / 2;
      expect(face).toBeGreaterThan(1200);
      [block, cutter, a, b].forEach((m) => m.delete());
    });
  }

  it('profile heights stay within ±amplitude/2', () => {
    for (const kind of ['step', 'zigzag', 'wave'] as const) {
      for (let x = -30; x <= 30; x += 0.7) expect(Math.abs(profileHeight({ kind, amplitude: 4, period: 9 }, x))).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
});

describe('free-hand stroke cut', () => {
  const frame: StrokeFrame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };

  it('a straight stroke behaves like a plane cut; the left side becomes B', () => {
    const block = wasm.Manifold.cube([40, 40, 40], true);
    // Drawn left → right along y = 5: the left of travel is +y.
    const cutter = strokeCutter(wasm, frame, [[-10, 5], [10, 5]], 200);
    const { a, b } = cutByCutter(wasm, block, cutter);
    expect(b.volume()).toBeCloseTo(40 * 40 * 15, 0);
    expect(a.volume()).toBeCloseTo(40 * 40 * 25, 0);
    expect(b.boundingBox().min[1]).toBeCloseTo(5, 3);
    [block, cutter, a, b].forEach((m) => m.delete());
  });

  it('a curved stroke yields two closed parts through the engine (with flip)', () => {
    const engine = new Engine(wasm);
    engine.addSource('s', wasm.Manifold.cube([40, 40, 40], true));
    const points = smoothStroke([[-30, -10], [-10, 8], [0, 0], [10, -8], [30, 10]]);
    const r = engine.evaluate([{ id: 's', name: 'Bloco' }], [{ kind: 'cut-surface', id: 'c1', target: 's', frame, points }]);
    expect(r.reports.c1.error).toBeUndefined();
    expect(r.parts).toHaveLength(2);
    expect(r.joints[0].planar).toBe(false);
    const total = r.parts.reduce((s, p) => s + p.stats.volume, 0);
    expect(total).toBeCloseTo(64000, 0);
    const flipped = engine.evaluate([{ id: 's', name: 'Bloco' }], [{ kind: 'cut-surface', id: 'c1', target: 's', frame, points, flip: true }]);
    expect(flipped.parts[0].stats.volume).toBeCloseTo(r.parts[1].stats.volume, 1);

    // Connectors are refused on non-planar joints with a clear reason.
    const k = engine.evaluate([{ id: 's', name: 'Bloco' }], [
      { kind: 'cut-surface', id: 'c1', target: 's', frame, points },
      { kind: 'connector', id: 'k1', joint: 'c1', type: 'pin', params: { diameter: 5, depth: 6, clearance: 0.2, chamfer: 0.5, minWall: 1.6, count: 'auto', maleSide: 'a' } },
    ]);
    expect(k.reports.k1.error).toMatch(/plano/);
    engine.dispose();
  });
});
