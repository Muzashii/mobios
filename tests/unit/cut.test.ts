import { beforeAll, describe, expect, it } from 'vitest';
import { cutByPlane } from '../../src/geometry/cut';
import { exampleFigure } from '../../src/geometry/primitives';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { normalize } from '../../src/geometry/math';
import type { Vec3 } from '../../src/geometry/types';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

describe('cutByPlane', () => {
  it('splits a cube into two closed halves on the correct sides', () => {
    const cube = wasm.Manifold.cube([20, 20, 20], true);
    const { a, b } = cutByPlane(wasm, cube, { origin: [0, 0, 5], normal: [0, 0, 1] });
    expect(a.status()).toBe('NoError');
    expect(b.status()).toBe('NoError');
    expect(a.volume()).toBeCloseTo(20 * 20 * 15, 3);
    expect(b.volume()).toBeCloseTo(20 * 20 * 5, 3);
    expect(b.boundingBox().min[2]).toBeCloseTo(5, 5); // B is on the normal side
    expect(a.boundingBox().max[2]).toBeCloseTo(5, 5);
    [cube, a, b].forEach((m) => m.delete());
  });

  it('throws when the plane misses the part', () => {
    const cube = wasm.Manifold.cube([10, 10, 10], true);
    expect(() => cutByPlane(wasm, cube, { origin: [0, 0, 50], normal: [0, 0, 1] })).toThrow(/não atravessa/);
    cube.delete();
  });

  it('bounded cut separates only the arm and keeps the body in one piece (golden)', () => {
    const fig = exampleFigure(wasm);
    const total = fig.volume();
    const dir = normalize([17, 0, -24]);
    const origin: Vec3 = [24, 0, 66];
    const { a, b } = cutByPlane(wasm, fig, { origin, normal: dir }, { center: origin, radius: 10 });
    const aParts = a.decompose();
    const bParts = b.decompose();
    expect(aParts.length).toBe(1);
    expect(bParts.length).toBe(1);
    expect(a.volume() + b.volume()).toBeCloseTo(total, 0);
    // The arm is a small fraction of the figure.
    expect(b.volume()).toBeLessThan(total * 0.1);
    expect(b.volume()).toBeGreaterThan(500);
    expect(b.boundingBox().min[0]).toBeGreaterThan(15);
    [fig, a, b, ...aParts, ...bParts].forEach((m) => m.delete());
  });

  it('bounded cut fails clearly when nothing fits in the radius', () => {
    const fig = exampleFigure(wasm);
    expect(() => cutByPlane(wasm, fig, { origin: [0, 0, 60], normal: [0, 0, 1] }, { center: [0, 0, 60], radius: 3 })).toThrow(/ilha/);
    fig.delete();
  });
});
