import { it } from 'vitest';
import { exampleFigure } from '../../src/geometry/primitives';
import { manifoldToMeshData } from '../../src/geometry/repair';
import { buildPartMap } from '../../src/geometry/segment/parts';
import { loadManifold } from '../../src/geometry/wasm';

it('synthetic figure with hat', async () => {
  const wasm = await loadManifold();
  const fig = exampleFigure(wasm);
  const brim = wasm.Manifold.cylinder(2, 19, 19, 96).translate([0, 0, 106]);
  const dome = wasm.Manifold.cylinder(10, 10, 9, 64).translate([0, 0, 107]);
  const map = buildPartMap(manifoldToMeshData(wasm.Manifold.union([fig, brim, dome])));
  for (const q of map.parts) console.log(q.id, q.name.padEnd(16), `${q.area.toFixed(0)}mm²`, q.regions.map((r) => `${map.regions[r].role[0]}${r}(t${map.regions[r].thickness.toFixed(1)})`).join(' '));
});
