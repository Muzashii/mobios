import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConnectorParams } from '../../src/geometry/connectors';
import { cutByPlane } from '../../src/geometry/cut';
import { boundedProfileCut, cutByCutter, strokeCutter } from '../../src/geometry/cutters';
import { Engine } from '../../src/geometry/engine';
import { MeshQuery } from '../../src/geometry/mesh/bvh';
import { buildTopology } from '../../src/geometry/mesh/topology';
import { trianglesIntersect } from '../../src/geometry/mesh/tritri';
import { exampleFigure } from '../../src/geometry/primitives';
import { manifoldToMeshData } from '../../src/geometry/repair';
import { FlowGraph } from '../../src/geometry/segment/mincut';
import { clusterSeeds, earClip } from './regioncut.helpers';
import { GeometryService } from '../../src/geometry/service';
import type { Operation, RegionCutOperation, SmartCutSuggestion, StrokeFrame, Vec3 } from '../../src/geometry/types';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { FIGURES } from '../fixtures/figures';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const SRC = [{ id: 's', name: 'Figura' }];
const regionOp = (s: SmartCutSuggestion, mode: RegionCutOperation['mode'], extra: Partial<RegionCutOperation> = {}): RegionCutOperation => ({
  kind: 'cut-region',
  id: 'c1',
  target: 's',
  balls: s.balls,
  seeds: s.seeds,
  level: s.candidates[0].level,
  mode,
  plane: s.candidates[0].plane,
  ...extra,
});

function figureEngine() {
  const engine = new Engine(wasm);
  engine.addSource('s', exampleFigure(wasm));
  return engine;
}

describe('building blocks', () => {
  it('min-cut finds the cheapest separation', () => {
    // s → a → t (cap 3) and s → b → t (cap 1+2): max flow 3 + 1 = 4.
    const g = new FlowGraph(4);
    g.addEdge(0, 1, 5, 0);
    g.addEdge(1, 3, 3, 0);
    g.addEdge(0, 2, 1, 0);
    g.addEdge(2, 3, 2, 0);
    expect(g.maxflow(0, 3)).toBeCloseTo(4);
    const side = g.sourceSide(0);
    expect(side[0]).toBe(1);
    expect(side[1]).toBe(1); // a still reachable (only a→t saturated)
    expect(side[3]).toBe(0);
  });

  it('triangle intersection: crossing yes, touching/coplanar no', () => {
    const A = [0, 0, 0, 2, 0, 0, 0, 2, 0];
    expect(trianglesIntersect(A, [0.5, 0.5, -1, 0.5, 0.5, 1, 1.5, 0.2, 0])).toBe(true);
    expect(trianglesIntersect(A, [0, 0, 1, 2, 0, 1, 0, 2, 1])).toBe(false);
    expect(trianglesIntersect(A, [0.2, 0.2, 0, 1, 0.2, 0, 0.2, 1, 0])).toBe(false);
  });

  it('topology: closed manifold has every edge paired', () => {
    const cube = wasm.Manifold.cube([10, 10, 10], true);
    const topo = buildTopology(manifoldToMeshData(cube));
    expect(topo.faceNbr.every((g) => g >= 0)).toBe(true);
    expect(topo.totalArea).toBeCloseTo(600, 3);
    cube.delete();
  });

  it('BVH ray queries keep the original face order (indirect)', () => {
    const cube = wasm.Manifold.cube([10, 10, 10], true);
    const mesh = manifoldToMeshData(cube);
    const q = new MeshQuery(mesh);
    const hit = q.first([0, 0, 20], [0, 0, -1])!;
    expect(hit.distance).toBeCloseTo(15, 4);
    // The face reported is really the top face (all its vertices at z = 5).
    for (let k = 0; k < 3; k++) expect(mesh.positions[mesh.indices[hit.face * 3 + k] * 3 + 2]).toBeCloseTo(5, 4);
    expect(q.hits([1.3, 2.1, 20], [0, 0, -1]).length).toBe(2); // off the face diagonals
    q.dispose();
    cube.delete();
  });

  it('ear clipping triangulates a concave polygon', () => {
    const tris = earClip([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]]);
    expect(tris).not.toBeNull();
    expect(tris!.length).toBe(9);
  });

  it('seeds far apart form separate clusters', () => {
    expect(clusterSeeds([[0, 0, 0], [1, 0, 0], [2, 0, 0], [50, 0, 0]], 2)).toHaveLength(2);
  });
});

describe('cut fixes (Fase B)', () => {
  it('C2: bounded plane keeps the island even when the plane grazes the body elsewhere', () => {
    // Plane across the arm that also clips the torso inside the same positive island: the old
    // "every touching vertex inside" rule rejected it; the majority rule accepts it.
    const fig = exampleFigure(wasm);
    const { a, b } = cutByPlane(wasm, fig, { origin: [24, 0, 66], normal: [0.578, 0, -0.816] }, { center: [24, 0, 66], radius: 7 });
    expect(b.volume()).toBeGreaterThan(300);
    expect(b.volume()).toBeLessThan(fig.volume() * 0.15);
    [fig, a, b].forEach((m) => m.delete());
  });

  it('C2: seeds pick the island (no sphere needed); other islands go back to A', () => {
    const fig = exampleFigure(wasm);
    // Horizontal plane at the hands' height crosses both arms and the torso.
    const keep: Vec3[] = [[35, 0, 44]];
    const { a, b } = cutByPlane(wasm, fig, { origin: [0, 0, 55], normal: [0, 0, -1] }, undefined, keep);
    const bb = b.boundingBox();
    expect(bb.min[0]).toBeGreaterThan(20); // only the right hand
    expect(a.decompose().length).toBe(1);
    [fig, a, b].forEach((m) => m.delete());
  });

  it('C4: bounded + profile now works (only the island inside the limit)', () => {
    const fig = exampleFigure(wasm);
    const plane = { origin: [24, 0, 66] as Vec3, normal: [0.578, 0, -0.816] as Vec3 };
    const { a, b } = boundedProfileCut(wasm, fig, plane, { kind: 'zigzag', amplitude: 2, period: 4 }, { center: plane.origin, radius: 9 });
    expect(b.volume()).toBeLessThan(fig.volume() * 0.15);
    expect(a.volume() + b.volume()).toBeCloseTo(fig.volume(), -1);
    [fig, a, b].forEach((m) => m.delete());
  });

  it('C5: perspective stroke follows the camera rays', () => {
    const block = wasm.Manifold.cube([40, 40, 40], true);
    // Eye 100 mm above the plane z = 0, stroke along x at y = 10 on that plane.
    const frame: StrokeFrame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], eye: [0, 0, 100] };
    const cutter = strokeCutter(wasm, frame, [[-10, 10], [10, 10]], 200);
    const { a, b } = cutByCutter(wasm, block, cutter);
    // The ray through y = 10 at z = 0 reaches y = 12 at z = −20 and y = 8 at z = +20.
    const box = b.boundingBox();
    expect(box.min[1]).toBeCloseTo(8, 1);
    expect(a.volume() + b.volume()).toBeCloseTo(64000, 0);
    [block, cutter, a, b].forEach((m) => m.delete());
  });

  it('C6: a connector that does not fit leaves the cut applied, with a warning', () => {
    const engine = new Engine(wasm);
    engine.addSource('s', wasm.Manifold.cylinder(40, 2, 2, 32));
    const r = engine.evaluate([{ id: 's', name: 'Haste' }], [
      { kind: 'cut-plane', id: 'c1', target: 's', plane: { origin: [0, 0, 20], normal: [0, 0, 1] } },
      { kind: 'connector', id: 'k1', joint: 'c1', type: 'pin', params: { ...defaultConnectorParams('FDM'), diameter: 8 } },
    ]);
    expect(r.reports.c1.error).toBeUndefined();
    expect(r.reports.k1.error).toBeUndefined();
    expect(r.reports.k1.warnings.join(' ')).toMatch(/diâmetro/);
    expect(r.parts).toHaveLength(2);
    engine.dispose();
  });

  it('C1: dry-run explains a cut that would fail, and never commits', () => {
    const engine = figureEngine();
    engine.evaluate(SRC, []);
    const bad = engine.checkCut({ kind: 'cut-plane', id: 'x', target: 's', plane: { origin: [0, 0, 500], normal: [0, 0, 1] } });
    expect(bad.ok).toBe(false);
    expect(bad.hint).toBe('move-plane');
    const good = engine.checkCut({ kind: 'cut-plane', id: 'x', target: 's', plane: { origin: [0, 0, 60], normal: [0, 0, 1] } });
    expect(good.ok).toBe(true);
    expect(good.piecesB).toBe(1);
    expect(engine.evaluate(SRC, []).parts).toHaveLength(1);
    engine.dispose();
  });
});

describe('SmartCut v2 — corte por região', () => {
  const svc = () => new GeometryService(wasm);

  it('arm → curved joint that follows the shoulder ring, B is just the arm, pins fit', () => {
    const fig = FIGURES[0];
    const engine = figureEngine();
    const service = svc();
    const solid = exampleFigure(wasm);
    const s = service.smartCutOn(solid, fig.seeds, fig.seedRadius);
    const op = regionOp(s, 'surface', { seeds: fig.seeds });
    const ops: Operation[] = [op, { kind: 'connector', id: 'k1', joint: 'c1', type: 'pin', params: { ...defaultConnectorParams('FDM'), diameter: 2, depth: 3, minWall: 1.2 } }];
    const r = engine.evaluate(SRC, ops);
    expect(r.reports.c1.error, r.reports.c1.error).toBeUndefined();
    expect(r.reports.c1.warnings).toEqual([]);
    const a = r.parts.find((p) => p.id === 'c1.a')!, b = r.parts.find((p) => p.id === 'c1.b')!;
    const total = solid.volume();
    // Pins move a few mm³ between the halves; the cut itself conserves volume.
    expect(Math.abs(a.stats.volume + b.stats.volume - total) / total).toBeLessThan(0.002);
    expect(b.stats.volume).toBeLessThan(total * 0.12);
    expect(b.stats.bounds.min[0]).toBeGreaterThan(10); // nothing of the torso
    const joint = r.joints[0];
    expect(joint.faceRadius).toBeGreaterThan(1.5);
    expect(joint.planar).toBe(true);
    expect(r.reports.k1.error).toBeUndefined();
    expect(r.reports.k1.info, r.reports.k1.warnings.join(' | ') + ' r=' + joint.faceRadius).toMatch(/×/);
    solid.delete();
    engine.dispose();
  });

  it('head → neck: auto mode, B is the head with a matching name', () => {
    const fig = FIGURES[1];
    const engine = figureEngine();
    const solid = exampleFigure(wasm);
    const s = svc().smartCutOn(solid, fig.seeds, fig.seedRadius);
    expect(s.candidates[0].name).toBe('Cabeça');
    const r = engine.evaluate(SRC, [regionOp(s, 'auto', { name: s.candidates[0].name })]);
    expect(r.reports.c1.error).toBeUndefined();
    const b = r.parts.find((p) => p.id === 'c1.b')!;
    expect(b.name).toBe('Cabeça');
    expect(b.stats.bounds.min[2]).toBeGreaterThan(72);
    solid.delete();
    engine.dispose();
  });

  it('shell mode: the region leaves as a shell and the body keeps a recess', () => {
    const fig = FIGURES[1];
    const engine = figureEngine();
    const solid = exampleFigure(wasm);
    const s = svc().smartCutOn(solid, fig.seeds, fig.seedRadius);
    const r = engine.evaluate(SRC, [regionOp(s, 'shell', { depth: 2 })]);
    expect(r.reports.c1.error, r.reports.c1.error).toBeUndefined();
    const a = r.parts.find((p) => p.id === 'c1.a')!, b = r.parts.find((p) => p.id === 'c1.b')!;
    expect(a.stats.volume + b.stats.volume).toBeCloseTo(solid.volume(), -1);
    // A 2 mm shell of a ~13 mm head: far less than the solid head (≈ 9200 mm³).
    expect(b.stats.volume).toBeLessThan(6000);
    expect(b.stats.volume).toBeGreaterThan(1000);
    expect(r.joints[0].planar).toBe(false);
    solid.delete();
    engine.dispose();
  });

  it('negative seeds keep the torso out of B', () => {
    const fig = FIGURES[0];
    const solid = exampleFigure(wasm);
    const s = svc().smartCutOn(solid, fig.seeds, fig.seedRadius, [[0, -16, 60]]);
    const engine = figureEngine();
    const r = engine.evaluate(SRC, [regionOp(s, 'auto', { negSeeds: [[0, -16, 60]] })]);
    const b = r.parts.find((p) => p.id === 'c1.b')!;
    expect(b.stats.bounds.min[0]).toBeGreaterThan(5);
    solid.delete();
    engine.dispose();
  });

  it('dabs on the head and on a hand become two suggestions', () => {
    const service = svc();
    service.engine.addSource('s', exampleFigure(wasm));
    service.evaluate(SRC, []);
    const res = service.smartCutClusters('s', [[0, 0, 111], [35, -6, 48]], 4);
    expect(res).toHaveLength(2);
    expect(res.every((r) => 'suggestion' in r)).toBe(true);
    service.engine.dispose();
  });

  it('hover returns the part under the cursor', () => {
    const service = svc();
    service.engine.addSource('s', exampleFigure(wasm));
    service.evaluate(SRC, []);
    const h = service.smartHover('s', [0, 0, 111], 4);
    expect(h).not.toBeNull();
    expect(h!.preview.length).toBeGreaterThan(9);
    expect(h!.loops.length).toBeGreaterThan(0);
    service.engine.dispose();
  });

  it('re-running the history after editing an earlier cut recomputes the region', () => {
    const fig = FIGURES[1];
    const solid = exampleFigure(wasm);
    const s = svc().smartCutOn(solid, fig.seeds, fig.seedRadius);
    const engine = figureEngine();
    // Cut the right arm off first, then the head on what remains.
    const ops: Operation[] = [
      { kind: 'cut-plane', id: 'c0', target: 's', plane: { origin: [26, 0, 63], normal: [0.578, 0, -0.816] }, bounded: { center: [26, 0, 63], radius: 9 } },
      { ...regionOp(s, 'auto'), target: 'c0.a' },
    ];
    const r = engine.evaluate(SRC, ops);
    expect(r.reports.c1.error, r.reports.c1.error).toBeUndefined();
    expect(r.parts.map((p) => p.id).sort()).toEqual(['c0.b', 'c1.a', 'c1.b']);
    solid.delete();
    engine.dispose();
  });
});
