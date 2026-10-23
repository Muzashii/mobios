import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConnectorParams } from '../../src/geometry/connectors';
import { Engine } from '../../src/geometry/engine';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import type { Operation } from '../../src/geometry/types';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const cut = (id: string, target: string, z: number): Operation => ({
  kind: 'cut-plane',
  id,
  target,
  plane: { origin: [0, 0, z], normal: [0, 0, 1] },
});

describe('Engine (editable history)', () => {
  it('re-executes from the edited operation and keeps ids stable', () => {
    const engine = new Engine(wasm);
    engine.addSource('s1', wasm.Manifold.cube([20, 20, 40], true));
    const sources = [{ id: 's1', name: 'Bloco' }];
    const ops = [cut('c1', 's1', 0), cut('c2', 'c1.b', 10)];

    const r1 = engine.evaluate(sources, ops);
    expect(r1.parts.map((p) => p.id)).toEqual(['c1.a', 'c2.a', 'c2.b']);
    expect(r1.parts.every((p) => p.mesh)).toBe(true);
    const vol = (r: typeof r1, id: string) => r.parts.find((p) => p.id === id)!.stats.volume;
    expect(vol(r1, 'c1.a')).toBeCloseTo(20 * 20 * 20, 3);

    // Edit the first cut: the second one is recomputed on top of it.
    const edited = [cut('c1', 's1', -10), ops[1]];
    const r2 = engine.evaluate(sources, edited);
    expect(r2.parts.map((p) => p.id)).toEqual(['c1.a', 'c2.a', 'c2.b']);
    expect(vol(r2, 'c1.a')).toBeCloseTo(20 * 20 * 10, 3);
    expect(vol(r2, 'c2.a')).toBeCloseTo(20 * 20 * 20, 3);
    expect(vol(r2, 'c2.b')).toBeCloseTo(20 * 20 * 10, 3);

    // Re-evaluating the same history does not resend meshes.
    const r3 = engine.evaluate(sources, edited);
    expect(r3.parts.some((p) => p.mesh)).toBe(false);
    engine.dispose();
  });

  it('reports a broken reference instead of failing the whole history', () => {
    const engine = new Engine(wasm);
    engine.addSource('s1', wasm.Manifold.cube(10, true));
    const r = engine.evaluate([{ id: 's1', name: 'Cubo' }], [cut('c1', 'nope', 0), cut('c2', 's1', 0)]);
    expect(r.reports.c1.error).toMatch(/não existe/);
    expect(r.reports.c2.error).toBeUndefined();
    expect(r.parts).toHaveLength(2);
    engine.dispose();
  });

  it('finds the cut face at non-zero heights (regression: rounding at the plane)', async () => {
    const { exampleFigure } = await import('../../src/geometry/primitives');
    const engine = new Engine(wasm);
    engine.addSource('fig', exampleFigure(wasm));
    const r = engine.evaluate([{ id: 'fig', name: 'Figura' }], [
      cut('c1', 'fig', 55),
      { kind: 'connector', id: 'k1', joint: 'c1', type: 'pin', params: defaultConnectorParams('FDM') },
    ]);
    expect(r.joints[0].faceArea).toBeGreaterThan(500);
    expect(r.reports.k1.error).toBeUndefined();
    expect(r.reports.k1.info).toMatch(/pino/);
    engine.dispose();
  });

  it('applies connectors on a joint and conserves volume (± pins)', () => {
    const engine = new Engine(wasm);
    engine.addSource('s1', wasm.Manifold.cube([30, 30, 40], true));
    const ops: Operation[] = [
      cut('c1', 's1', 0),
      { kind: 'connector', id: 'k1', joint: 'c1', type: 'dowel', params: defaultConnectorParams('FDM') },
    ];
    const r = engine.evaluate([{ id: 's1', name: 'Bloco' }], ops);
    expect(r.reports.k1.error).toBeUndefined();
    expect(r.parts.map((p) => p.id)).toEqual(['c1.a', 'c1.b', 'k1.pins']);
    expect(r.joints).toHaveLength(1);
    expect(r.joints[0].faceArea).toBeCloseTo(900, 0);
    const total = r.parts.filter((p) => p.id !== 'k1.pins').reduce((s, p) => s + p.stats.volume, 0);
    expect(total).toBeLessThan(30 * 30 * 40);
    engine.dispose();
  });
});
