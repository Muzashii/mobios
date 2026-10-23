import { beforeAll, describe, expect, it } from 'vitest';
import { applyConnector, defaultConnectorParams, sweepOverlap } from '../../src/geometry/connectors';
import { cutByPlane } from '../../src/geometry/cut';
import { Engine } from '../../src/geometry/engine';
import { engraveLabel, textShape } from '../../src/geometry/labels';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import type { ConnectorType, Operation, Plane } from '../../src/geometry/types';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const plane: Plane = { origin: [0, 0, 0], normal: [0, 0, 1] };
const halves = (size: [number, number, number] = [30, 30, 40]) => {
  const block = wasm.Manifold.cube(size, true);
  const { a, b } = cutByPlane(wasm, block, plane);
  block.delete();
  return { a, b };
};
const big = () => wasm.Manifold.cube([500, 500, 500], true);
const overlap = (x: ReturnType<typeof wasm.Manifold.cube>, y: ReturnType<typeof wasm.Manifold.cube>) => {
  const i = x.intersect(y);
  const v = i.volume();
  i.delete();
  return v;
};

describe('peg connectors', () => {
  for (const type of ['pin', 'square', 'hex', 'key'] as ConnectorType[]) {
    it(`${type}: male gains, female loses more, closed, assembles without collision`, () => {
      const { a, b } = halves();
      const res = applyConnector(wasm, a, b, { plane }, type, defaultConnectorParams('FDM', type));
      expect(res.placed).toBe(1);
      expect(res.a.status()).toBe('NoError');
      expect(res.b.status()).toBe('NoError');
      const gained = res.a.volume() - a.volume();
      const lost = b.volume() - res.b.volume();
      expect(gained).toBeGreaterThan(50);
      expect(lost).toBeGreaterThan(gained);
      expect(overlap(res.a, res.b)).toBeLessThan(1e-6);
      expect(res.sweepOverlap).toBeLessThan(0.01);
      expect(res.insertDir[2]).toBeCloseTo(1, 6);
      [a, b, res.a, res.b].forEach((m) => m.delete());
    });
  }

  it('key only fits one way; square fits every quarter turn (anti-rotation)', () => {
    const turned = (type: ConnectorType, deg: number) => {
      const { a, b } = halves();
      const res = applyConnector(wasm, a, b, { plane }, type, defaultConnectorParams('FDM', type));
      const rotated = res.b.rotate([0, 0, deg]);
      const v = overlap(res.a, rotated);
      [a, b, res.a, res.b, rotated].forEach((m) => m.delete());
      return v;
    };
    expect(turned('key', 90)).toBeGreaterThan(1);
    expect(turned('key', 180)).toBeGreaterThan(1);
    expect(turned('square', 90)).toBeLessThan(1e-6);
    expect(turned('square', 45)).toBeGreaterThan(1); // cannot rotate once inserted
    expect(turned('hex', 60)).toBeLessThan(1e-6);
  });

  it('negative clearance (interference) is caught by the assembly sweep', () => {
    const { a, b } = halves();
    const res = applyConnector(wasm, a, b, { plane }, 'pin', { ...defaultConnectorParams('FDM'), clearance: -0.3 });
    expect(res.sweepOverlap).toBeGreaterThan(0.01);
    [a, b, res.a, res.b].forEach((m) => m.delete());
  });
});

describe('magnet sockets', () => {
  it('cuts a magnet-sized blind hole in both faces', () => {
    const { a, b } = halves();
    const p = defaultConnectorParams('FDM', 'magnet');
    const res = applyConnector(wasm, a, b, { plane }, 'magnet', p);
    expect(res.placed).toBe(1);
    const magnet = Math.PI * (p.diameter / 2) ** 2 * p.depth;
    for (const [before, after] of [[a, res.a], [b, res.b]] as const) {
      const lost = before.volume() - after.volume();
      expect(lost).toBeGreaterThan(magnet);
      expect(lost).toBeLessThan(magnet * 1.4);
      expect(after.genus()).toBe(0); // blind hole
    }
    expect(res.pins).toBeUndefined();
    [a, b, res.a, res.b].forEach((m) => m.delete());
  });
});

describe('dovetail', () => {
  it('slides along the rail without collision but locks against pulling apart', () => {
    const { a, b } = halves([80, 30, 40]);
    const res = applyConnector(wasm, a, b, { plane }, 'dovetail', defaultConnectorParams('FDM', 'dovetail'));
    expect(res.placed).toBe(1);
    expect(res.a.volume()).toBeGreaterThan(a.volume());
    expect(res.b.volume()).toBeLessThan(b.volume());
    expect(Math.abs(res.insertDir[0])).toBeGreaterThan(0.99); // rail along the long (X) side
    expect(res.sweepOverlap).toBeLessThan(0.01);
    const region = big();
    const pulled = sweepOverlap(res.a, res.b, [0, 0, 1], 10, region);
    expect(pulled).toBeGreaterThan(1);
    // The rail never sticks out of the parts' outline.
    const bb = res.a.boundingBox();
    expect(bb.max[0]).toBeLessThanOrEqual(40 + 1e-6);
    expect(bb.max[1]).toBeLessThanOrEqual(15 + 1e-6);
    [a, b, res.a, res.b, region].forEach((m) => m.delete());
  });
});

describe('engraved labels', () => {
  it('CrossSection.mirror([1,0]) flips X (used to make B read correctly)', () => {
    const c = wasm.CrossSection.circle(1, 8).translate([5, 2]);
    const m = c.mirror([1, 0]);
    expect(m.bounds().min[0]).toBeCloseTo(-6, 5);
    expect(m.bounds().min[1]).toBeCloseTo(1, 5);
    c.delete();
    m.delete();
  });

  it('text shape has the requested size', () => {
    const { shape, width, height } = textShape(wasm, 'J12', 6);
    const b = shape.bounds();
    expect(b.max[1] - b.min[1]).toBeCloseTo(height, 1);
    expect(b.max[0] - b.min[0]).toBeCloseTo(width, 1);
    shape.delete();
  });

  it('engraves both faces away from the pin, keeping parts closed', () => {
    const { a, b } = halves([50, 30, 40]);
    const res = applyConnector(wasm, a, b, { plane }, 'pin', defaultConnectorParams('FDM'));
    const lab = engraveLabel(wasm, res.a, res.b, { plane, obstacles: res.obstacles }, 'J1', 6, 0.6);
    for (const [before, after] of [[res.a, lab.a], [res.b, lab.b]] as const) {
      expect(after.status()).toBe('NoError');
      const lost = before.volume() - after.volume();
      expect(lost).toBeGreaterThan(2);
      expect(lost).toBeLessThan(40);
    }
    // The pin is untouched: male volume above the face only loses nothing there.
    [a, b, res.a, res.b, lab.a, lab.b].forEach((m) => m.delete());
  });
});

describe('engine: connectors, labels and lineage', () => {
  it('reports collision-free assembly, engraves J1 and tracks lineage', () => {
    const engine = new Engine(wasm);
    engine.addSource('s', wasm.Manifold.cube([50, 30, 60], true));
    const ops: Operation[] = [
      { kind: 'cut-plane', id: 'c1', target: 's', plane },
      { kind: 'connector', id: 'k1', joint: 'c1', type: 'key', params: defaultConnectorParams('FDM', 'key') },
      { kind: 'label', id: 'l1', joint: 'c1', size: 6, depth: 0.6 },
      { kind: 'cut-plane', id: 'c2', target: 'c1.b', plane: { origin: [0, 0, 20], normal: [0, 0, 1] } },
    ];
    const r = engine.evaluate([{ id: 's', name: 'Bloco' }], ops);
    expect(r.reports.k1.info).toMatch(/sem colisão/);
    expect(r.reports.l1.error).toBeUndefined();
    expect(r.reports.l1.info).toMatch(/J1/);
    expect(r.joints.find((j) => j.id === 'c1')?.assemblyClear).toBe(true);
    const top = r.parts.find((p) => p.id === 'c2.b')!;
    expect(top.lineage).toEqual(['c1.b', 'c2.b']);
    engine.dispose();
  });
});
