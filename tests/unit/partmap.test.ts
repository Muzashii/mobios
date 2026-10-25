import { beforeAll, describe, expect, it } from 'vitest';
import { MeshQuery } from '../../src/geometry/mesh/bvh';
import { exampleFigure } from '../../src/geometry/primitives';
import { manifoldToMeshData } from '../../src/geometry/repair';
import { buildPartMap, type PartMap } from '../../src/geometry/segment/parts';
import { localThickness, SolidGrid } from '../../src/geometry/segment/volume';
import type { MeshData, Vec3 } from '../../src/geometry/types';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

/** The example figure wearing a hat: dome on a flat brim that rests on the head. */
function figureWithHat(): MeshData {
  const fig = exampleFigure(wasm);
  const brim = wasm.Manifold.cylinder(2, 19, 19, 96).translate([0, 0, 106]);
  const dome = wasm.Manifold.cylinder(10, 10, 9, 64).translate([0, 0, 107]);
  const all = wasm.Manifold.union([fig, brim, dome]);
  const mesh = manifoldToMeshData(all);
  [fig, brim, dome, all].forEach((m) => m.delete());
  return mesh;
}

describe('local thickness', () => {
  it('is the inscribed ball diameter', () => {
    const box = wasm.Manifold.cube([40, 40, 6], true);
    const mesh = manifoldToMeshData(box);
    box.delete();
    const q = new MeshQuery(mesh);
    const grid = new SolidGrid(mesh, q, 0.25);
    q.dispose();
    const lt = localThickness(grid.inside, grid.n);
    const [nx, ny] = grid.n;
    const centre = Math.floor(nx / 2) + nx * (Math.floor(ny / 2) + ny * Math.floor(grid.n[2] / 2));
    expect(2 * lt[centre] * grid.h).toBeGreaterThan(5);
    expect(2 * lt[centre] * grid.h).toBeLessThan(7);
  });
});

describe('part map', () => {
  let mesh: MeshData;
  let map: PartMap;
  let query: MeshQuery;
  const partAt = (from: Vec3, dir: Vec3) => {
    const hit = query.first(from, dir);
    return hit ? map.parts[map.facePart[hit.face]].name : 'nada';
  };

  beforeAll(() => {
    mesh = figureWithHat();
    map = buildPartMap(mesh);
    query = new MeshQuery(mesh);
  });

  it('finds the parts a person would name', () => {
    const names = map.parts.map((p) => p.name);
    for (const n of ['Chapéu', 'Cabeça', 'Tronco', 'Braço esquerdo', 'Braço direito', 'Perna esquerda', 'Perna direita', 'Base']) expect(names).toContain(n);
  });

  it('keeps the brim with the hat, not with the head', () => {
    expect(partAt([0, 0, 200], [0, 0, -1])).toBe('Chapéu'); // top of the dome
    expect(partAt([-100, 0, 107], [1, 0, 0])).toBe('Chapéu'); // brim rim
    expect(partAt([0, -100, 96], [0, 1, 0])).toBe('Cabeça'); // face
  });

  it('keeps each hand with its arm and stops the arm at the shoulder', () => {
    expect(partAt([-100, 0, 50], [1, 0, 0])).toBe('Braço direito'); // hand (−X is the figure's right)
    expect(partAt([0, -100, 64], [0, 1, 0])).toBe('Tronco');
    expect(partAt([100, 0, 50], [-1, 0, 0])).toBe('Braço esquerdo');
  });

  it('separates the legs from each other and from the base', () => {
    expect(partAt([-9, -100, 24], [0, 1, 0])).toBe('Perna direita');
    expect(partAt([9, -100, 24], [0, 1, 0])).toBe('Perna esquerda');
    expect(partAt([0, -100, 3], [0, 1, 0])).toBe('Base');
  });
});

describe('cortar por parte detectada', () => {
  it('a point on the hat cuts off exactly the hat (dome + brim), as two closed solids', async () => {
    const { Engine } = await import('../../src/geometry/engine');
    const { meshDataToManifold } = await import('../../src/geometry/repair');
    const engine = new Engine(wasm);
    const solid = meshDataToManifold(wasm, figureWithHat());
    const total = solid.volume();
    engine.addSource('fig', solid);
    const top: Vec3 = [0, 0, 117];
    const r = engine.evaluate([{ id: 'fig', name: 'Figura' }], [
      { kind: 'cut-region', id: 'c1', target: 'fig', balls: [], seeds: [top], partSeeds: [top], level: 0, mode: 'auto', plane: { origin: [0, 0, 106], normal: [0, 0, 1] } },
    ]);
    expect(r.reports.c1.error, r.reports.c1.error).toBeUndefined();
    const a = r.parts.find((p) => p.id === 'c1.a')!, b = r.parts.find((p) => p.id === 'c1.b')!;
    expect(b.stats.bounds.min[2]).toBeGreaterThan(102); // nothing of the head below the brim
    expect(b.stats.bounds.max[0] - b.stats.bounds.min[0]).toBeGreaterThan(36); // the brim came along
    expect(Math.abs(a.stats.volume + b.stats.volume - total) / total).toBeLessThan(0.01);
    engine.dispose();
  });
});
