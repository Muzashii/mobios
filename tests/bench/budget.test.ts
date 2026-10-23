import { expect, it } from 'vitest';
import { cutByPlane } from '../../src/geometry/cut';
import { loadManifold } from '../../src/geometry/wasm';
import { denseSphere } from './fixtures';

// SPEC §4 target: cutting 500k triangles in < 500 ms. manifold-3d WASM is
// single-threaded and measures ~850 ms on a typical laptop (see docs/ADR/0003).
// The hard ceiling below catches regressions; the target is reported every run.
const TARGET_MS = 500;
const CEILING_MS = 1500;

it('plane cut of ~500k triangles stays within the performance ceiling', async () => {
  const wasm = await loadManifold();
  const sphere = denseSphere(wasm);
  expect(sphere.numTri()).toBeGreaterThan(400_000);
  const times: number[] = [];
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    const { a, b } = cutByPlane(wasm, sphere, { origin: [2, 1, 0], normal: [0.2, 0.1, 0.97] });
    a.numTri();
    times.push(performance.now() - t0);
    a.delete();
    b.delete();
  }
  const best = Math.min(...times.slice(1)); // first run is warm-up
  const verdict = best <= TARGET_MS ? 'dentro da meta' : `acima da meta de ${TARGET_MS} ms`;
  console.log(`corte 500k: ${best.toFixed(0)} ms (${verdict})`);
  expect(best).toBeLessThan(CEILING_MS);
  sphere.delete();
});

const time = (fn: () => void, runs = 2) => {
  fn(); // warm-up
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
};

it('reports the other pipeline stages at 500k triangles', async () => {
  const { applyConnector, defaultConnectorParams } = await import('../../src/geometry/connectors');
  const { toDisplayMesh } = await import('../../src/geometry/display');
  const { manifoldToMeshData, repairMesh } = await import('../../src/geometry/repair');
  const wasm = await loadManifold();
  const sphere = denseSphere(wasm);
  const mesh = manifoldToMeshData(sphere);
  const plane = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

  const connector = time(() => {
    const { a, b } = cutByPlane(wasm, sphere, plane);
    const r = applyConnector(wasm, a, b, { plane }, 'dowel', defaultConnectorParams('FDM'));
    r.a.numTri();
    [a, b, r.a, r.b, r.pins].forEach((m) => m?.delete());
  }, 1);
  const soup = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) soup.set(mesh.positions.subarray(mesh.indices[i] * 3, mesh.indices[i] * 3 + 3), i * 3);
  const repair = time(() => repairMesh(wasm, soup).manifold.delete(), 1);
  const display = time(() => toDisplayMesh(mesh));

  console.table({
    'corte + pinos soltos (ms)': connector.toFixed(0),
    'importação: solda + validação (ms)': repair.toFixed(0),
    'malha de exibição (ms)': display.toFixed(0),
  });
  expect(display).toBeLessThan(1500);
  sphere.delete();
});

it('SmartCut v2 on a ~500k-triangle figure: suggestion, hover and region cut', async () => {
  const { exampleFigure } = await import('../../src/geometry/primitives');
  const { GeometryService } = await import('../../src/geometry/service');
  const { clearRegionContexts } = await import('../../src/geometry/smartcut');
  const wasm = await loadManifold();
  const base = exampleFigure(wasm);
  const fig = base.refineToLength(0.38);
  base.delete();
  const svc = new GeometryService(wasm);
  svc.engine.addSource('s', fig);
  svc.evaluate([{ id: 's', name: 'f' }], []);
  clearRegionContexts();
  const tris = fig.numTri();
  let t0 = performance.now();
  const s = svc.smartCut('s', [[0, -13, 98]], 4);
  const first = performance.now() - t0; // includes building the proxy + BVH (once per part)
  t0 = performance.now();
  const arm = svc.smartCut('s', [[28, -5.4, 62]], 4);
  const cached = performance.now() - t0;
  t0 = performance.now();
  const h = svc.smartHover('s', [-35, -6.5, 50], 4);
  const hover = performance.now() - t0;
  expect(h).not.toBeNull();
  expect(s.candidates[0].name).toBe('Cabeça');
  expect(arm.candidates[0].plane.origin[2]).toBeGreaterThan(66);
  t0 = performance.now();
  const c = s.candidates[0];
  const r = svc.evaluate([{ id: 's', name: 'f' }], [{ kind: 'cut-region', id: 'c1', target: 's', balls: s.balls, seeds: s.seeds, level: c.level, mode: 'auto', plane: c.plane }]);
  const cut = performance.now() - t0;
  console.table({ triângulos: tris, 'sugestão 1ª vez (ms)': first.toFixed(0), 'sugestão com cache (ms)': cached.toFixed(0), 'hover (ms)': hover.toFixed(0), 'corte por região (ms)': cut.toFixed(0) });
  expect(r.reports.c1.error).toBeUndefined();
  expect(tris).toBeGreaterThan(400_000);
  // Plan targets: suggestion < 1.5 s at 500k; cut < 2 s (generous ceilings for CI noise).
  expect(first).toBeLessThan(4000);
  expect(cut).toBeLessThan(6000);
  svc.engine.dispose();
}, 300_000);
