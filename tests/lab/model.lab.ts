import fs from 'node:fs';
import { it } from 'vitest';
import { partMapOf } from '../../src/geometry/partmap';
import { GeometryService } from '../../src/geometry/service';
import type { InspectionReport, RepairPlan } from '../../src/geometry/types';
import { loadManifold } from '../../src/geometry/wasm';
import { quietPlan } from '../../src/features/import/importActions';
import { LAB, writeLabels, writeMesh } from './common';

/**
 * Any model through the exact app path (quiet import + part map); writes <LAB>/imp.* for the
 * viewer. MOBIOS_LAB_DIR=.lab/<name>, model at <LAB>/model.stl.
 */
it.skipIf(!fs.existsSync(`${LAB}/model.stl`))('model through the app path', async () => {
  const service = new GeometryService(await loadManifold());
  const buf = fs.readFileSync(`${LAB}/model.stl`);
  const [report] = service.inspectFile('model.stl', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'fig', 'FDM') as InspectionReport[];
  const { meshes } = service.finishImport('fig', quietPlan(report) as RepairPlan);
  const m = service.engine.source('fig')!;
  const r = partMapOf(m, (proxy) => writeMesh('proxy', proxy));
  writeMesh('imp', meshes[0].mesh);
  writeLabels('imp', Int32Array.from(r.labels));
  console.log(meshes[0].mesh.indices.length / 3, 'tris', r.ms, 'ms ::', r.parts.map((p) => `${p.name} ${(p.share * 100).toFixed(0)}%`).join(' | '));
});
