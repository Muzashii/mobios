import { beforeAll, describe, expect, it } from 'vitest';
import { fitsVolume } from '../../src/geometry/autosplit';
import { Engine } from '../../src/geometry/engine';
import { hollowPart } from '../../src/geometry/hollow';
import { analyzePrintability, suggestOrientation } from '../../src/geometry/printability';
import { exampleFigure } from '../../src/geometry/primitives';
import { GeometryService, orientDown, packComponents } from '../../src/geometry/service';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import type { Vec3 } from '../../src/geometry/types';
import { boxMesh } from '../fixtures/meshes';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const A1_MINI: Vec3 = [180, 180, 180];

describe('auto-split to fit the bed (critério da Fase 7)', () => {
  it('splits a 330 mm figure so every piece fits a Bambu A1 mini', () => {
    const service = new GeometryService(wasm);
    const big = exampleFigure(wasm).scale(3); // ≈ 210 × 80 × 330 mm
    service.engine.addSource('big', big);
    const sources = [{ id: 'big', name: 'Gigante' }];
    service.evaluate(sources, []);
    const plan = service.autoSplit('big', A1_MINI, 'FDM');
    expect(plan.cuts).toBeGreaterThanOrEqual(2);
    // Arms need one cut; the 204 mm round base needs two crossing cuts.
    expect(plan.cuts).toBeLessThanOrEqual(6);

    const r = service.evaluate(sources, plan.ops);
    const errors = Object.values(r.reports).filter((x) => x.error);
    expect(errors).toEqual([]);
    const solids = r.parts.filter((p) => !p.id.endsWith('.pins'));
    expect(solids.length).toBe(plan.pieces);
    for (const p of solids) {
      const size = [0, 1, 2].map((k) => p.stats.bounds.max[k] - p.stats.bounds.min[k]);
      expect(fitsVolume(size, A1_MINI), `${p.name}: ${size.map((v) => v.toFixed(0)).join('×')}`).toBe(true);
    }
    // Volume is conserved up to the dowel holes.
    const total = solids.reduce((s, p) => s + p.stats.volume, 0);
    expect(total).toBeLessThan(big.volume());
    expect(total).toBeGreaterThan(big.volume() * 0.98);
    // Loose pins are exported packed: that group must fit too.
    const pins = r.parts.filter((p) => p.id.endsWith('.pins'));
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) {
      const packed = packComponents(wasm, service.engine.part(p.id)!);
      const b = packed.boundingBox();
      expect(fitsVolume([0, 1, 2].map((k) => b.max[k] - b.min[k]), A1_MINI)).toBe(true);
      packed.delete();
    }
    service.engine.dispose();
  });

  it('does nothing when the part already fits', () => {
    const service = new GeometryService(wasm);
    service.engine.addSource('s', wasm.Manifold.cube([100, 50, 170], true));
    service.evaluate([{ id: 's', name: 'Bloco' }], []);
    expect(service.autoSplit('s', A1_MINI, 'FDM').ops).toEqual([]);
    service.engine.dispose();
  });
});

describe('printability', () => {
  it('a block on the plate has no overhangs; a T has them', () => {
    const block = wasm.Manifold.cube([20, 20, 20]);
    const rb = analyzePrintability(block, 'FDM');
    expect(rb.overhangArea).toBeCloseTo(0, 6);
    expect(rb.baseArea).toBeCloseTo(400, 3);
    expect(rb.minThickness).toBeGreaterThan(19);

    const stem = wasm.Manifold.cube([10, 10, 30]);
    const bar = wasm.Manifold.cube([40, 10, 6]).translate([-15, 0, 30]);
    const t = stem.add(bar);
    const rt = analyzePrintability(t, 'FDM');
    expect(rt.overhangArea).toBeCloseTo(300, 0); // underside of both arms
    [block, stem, bar, t].forEach((m) => m.delete());
  });

  it('the example figure stands flat on its base (regression: feet poked through)', () => {
    const fig = exampleFigure(wasm);
    const r = analyzePrintability(fig, 'FDM');
    expect(r.baseArea).toBeGreaterThan(Math.PI * 32 * 32 * 0.95);
    fig.delete();
  });

  it('flags thin walls', () => {
    const plate = wasm.Manifold.cube([40, 40, 0.4]);
    expect(analyzePrintability(plate, 'FDM').thinPct).toBeGreaterThan(80);
    plate.delete();
  });

  it('suggests putting the flat cut face down', () => {
    // A half-sphere sitting on its round side: flipping it (cut face down) removes overhangs.
    const ball = wasm.Manifold.sphere(20, 64);
    const [, bottom] = ball.splitByPlane([0, 0, 1], 0); // lower half, flat face up (+Z)
    const s = suggestOrientation(bottom, 'FDM', [{ normal: [0, 0, 1], label: 'J1' }]);
    expect(s.down).toEqual([0, 0, 1]);
    expect(s.label).toMatch(/J1/);
    expect(s.report.overhangArea).toBeLessThan(s.current.overhangArea * 0.2);
    [ball, bottom].forEach((m) => m.delete());
  });

  it('orientDown puts the chosen side on z = 0', () => {
    const m = orientDown(boxMesh(10, [0, 0, 50]), [1, 0, 0]);
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < m.positions.length; i += 3) { minZ = Math.min(minZ, m.positions[i]); maxZ = Math.max(maxZ, m.positions[i]); }
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(10, 4);
  });
});

describe('resin hollowing', () => {
  it('keeps a shell of the requested wall and drills drains', () => {
    const ball = wasm.Manifold.sphere(30, 96);
    const res = hollowPart(wasm, ball, 2.5, 3, 2);
    expect(res.part.status()).toBe('NoError');
    const shell = (4 / 3) * Math.PI * (30 ** 3 - 27.5 ** 3);
    expect(res.part.volume()).toBeGreaterThan(shell * 0.8);
    expect(res.part.volume()).toBeLessThan(shell * 1.3);
    expect(res.drains).toBeGreaterThanOrEqual(1);
    expect(res.warnings).toEqual([]);
    // Drained cavity is open to the outside: a single shell, not shell + sealed void.
    expect(res.part.genus()).toBeGreaterThanOrEqual(0);
    res.part.delete();
    ball.delete();
  });

  it('warns about suction cups without drains', () => {
    const box = wasm.Manifold.cube([40, 40, 40], true);
    const res = hollowPart(wasm, box, 2, 3, 0);
    expect(res.warnings.join(' ')).toMatch(/ventosa/);
    res.part.delete();
    box.delete();
  });

  it('runs as a history operation', () => {
    const engine = new Engine(wasm);
    engine.addSource('s', wasm.Manifold.sphere(25, 64));
    const r = engine.evaluate([{ id: 's', name: 'Bola' }], [{ kind: 'hollow', id: 'h1', target: 's', wall: 2, drainDiameter: 3, drainCount: 1 }]);
    expect(r.reports.h1.error).toBeUndefined();
    expect(r.reports.h1.info).toMatch(/resina/);
    expect(r.parts[0].stats.volume).toBeLessThan((4 / 3) * Math.PI * 25 ** 3 * 0.4);
    engine.dispose();
  });
});
