import { beforeAll, describe, expect, it } from 'vitest';
import { applyConnector, defaultConnectorParams } from '../../src/geometry/connectors';
import { cutByPlane } from '../../src/geometry/cut';
import { placeConnectors } from '../../src/geometry/placement';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import type { Plane, Vec2 } from '../../src/geometry/types';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const rect = (w: number, h: number): Vec2[][] => [[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]];

describe('placement', () => {
  it('puts a single pin at the centre of a square', () => {
    const [c, ...rest] = placeConnectors(rect(30, 30), { keepout: 4, count: 'auto' });
    expect(rest).toHaveLength(0);
    expect(Math.hypot(c[0], c[1])).toBeLessThan(0.6);
  });

  it('spreads pins along elongated faces', () => {
    const pins = placeConnectors(rect(120, 20), { keepout: 4.5, count: 'auto' });
    expect(pins.length).toBe(3);
    const xs = pins.map((p) => p[0]).sort((a, b) => a - b);
    expect(xs[2] - xs[0]).toBeGreaterThan(50);
    for (const [, y] of pins) expect(Math.abs(y)).toBeLessThan(1.5);
  });

  it('returns nothing when the face is too thin', () => {
    expect(placeConnectors(rect(60, 6), { keepout: 4.5, count: 'auto' })).toHaveLength(0);
  });
});

describe('applyConnector', () => {
  const plane: Plane = { origin: [0, 0, 0], normal: [0, 0, 1] };

  it('pin: male gains the pin, female loses a larger hole, both stay manifold', () => {
    const block = wasm.Manifold.cube([30, 30, 40], true);
    const { a, b } = cutByPlane(wasm, block, plane);
    const p = defaultConnectorParams('FDM');
    const res = applyConnector(wasm, a, b, { plane }, 'pin', p);
    expect(res.placed).toBe(1);
    expect(res.a.status()).toBe('NoError');
    expect(res.b.status()).toBe('NoError');
    const pinVol = res.a.volume() - a.volume();
    const holeVol = b.volume() - res.b.volume();
    expect(pinVol).toBeGreaterThan(Math.PI * 2.5 ** 2 * p.depth * 0.85);
    expect(holeVol).toBeGreaterThan(pinVol); // clearance
    // Pin must physically fit: the male part never overlaps the female part.
    const overlap = res.a.intersect(res.b);
    expect(overlap.volume()).toBeLessThan(1e-6);
    expect(res.a.genus()).toBe(0);
    expect(res.b.genus()).toBe(0);
    [block, a, b, res.a, res.b, overlap].forEach((m) => m.delete());
  });

  it('pin on side B flips direction', () => {
    const block = wasm.Manifold.cube([30, 30, 40], true);
    const { a, b } = cutByPlane(wasm, block, plane);
    const res = applyConnector(wasm, a, b, { plane }, 'pin', { ...defaultConnectorParams('RESINA'), maleSide: 'b' });
    expect(res.b.volume()).toBeGreaterThan(b.volume());
    expect(res.a.volume()).toBeLessThan(a.volume());
    expect(res.b.boundingBox().min[2]).toBeLessThan(-3);
    [block, a, b, res.a, res.b].forEach((m) => m.delete());
  });

  it('dowel: holes on both sides plus a separate pin part that fits', () => {
    const block = wasm.Manifold.cube([60, 20, 40], true);
    const { a, b } = cutByPlane(wasm, block, plane);
    const res = applyConnector(wasm, a, b, { plane }, 'dowel', defaultConnectorParams('FDM'));
    expect(res.placed).toBeGreaterThanOrEqual(2);
    expect(res.pins).toBeDefined();
    expect(res.a.volume()).toBeLessThan(a.volume());
    expect(res.b.volume()).toBeLessThan(b.volume());
    const clashA = res.pins!.intersect(res.a);
    const clashB = res.pins!.intersect(res.b);
    expect(clashA.volume() + clashB.volume()).toBeLessThan(1e-6);
    [block, a, b, res.a, res.b, res.pins!, clashA, clashB].forEach((m) => m.delete());
  });

  it('never breaks through a thin wall: shortens the pin', () => {
    // 12 mm tall slab above the cut: a 6 mm pin + wall still fits, a 14 mm one must be shortened.
    const slab = wasm.Manifold.cube([30, 30, 24], true);
    const { a, b } = cutByPlane(wasm, slab, plane);
    const res = applyConnector(wasm, a, b, { plane }, 'pin', { ...defaultConnectorParams('FDM'), depth: 14 });
    expect(res.placed).toBe(1);
    expect(res.warnings.join(' ')).toMatch(/reduzida/);
    expect(res.b.genus()).toBe(0); // still a blind hole: did not pierce the top
    [slab, a, b, res.a, res.b].forEach((m) => m.delete());
  });
});
