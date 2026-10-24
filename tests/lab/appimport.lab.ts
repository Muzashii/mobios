import fs from 'node:fs';
import { it } from 'vitest';
import { partMapOf } from '../../src/geometry/partmap';
import { GeometryService } from '../../src/geometry/service';
import type { InspectionReport, RepairPlan } from '../../src/geometry/types';
import { loadManifold } from '../../src/geometry/wasm';
import { FIGURE_PARTS, LAB, picker, writeLabels, writeMesh } from './common';

const MODEL = process.env.MOBIOS_LAB_MODEL ?? `${LAB}/boneco.stl`;

/** Same as importActions.recommendedPlan (first option of every issue). */
const recommended = (r: InspectionReport): RepairPlan => Object.fromEntries(r.issues.filter((i) => i.options.length).map((i) => [i.kind, i.options[0].value]));

/** The exact app path: Raio-X import with the recommended repairs, then the part map. */
it.skipIf(!fs.existsSync(MODEL))('part map after the app import', async () => {
  const service = new GeometryService(await loadManifold());
  const buf = fs.readFileSync(MODEL);
  const [report] = service.inspectFile('boneco.stl', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'fig', 'FDM');
  const { meshes } = service.finishImport('fig', recommended(report));
  const mesh = meshes[0].mesh;
  console.log('imported', mesh.indices.length / 3, 'triangles');
  const m = service.engine.part('fig') ?? (service.evaluate([{ id: 'fig', name: 'fig' }] as never, [], true), service.engine.part('fig'))!;
  const r = partMapOf(m, (proxy) => writeMesh('imp', proxy));
  writeMesh('impfull', mesh);
  writeLabels('impfull', Int32Array.from(r.labels));
  const pick = picker(mesh);
  let ok = 0;
  for (const exp of FIGURE_PARTS) {
    const at = (ray: (typeof exp)['click']) => { const h = pick(...ray); return h ? r.labels[h.face] : -1; };
    const p = at(exp.click);
    const pass = p >= 0 && exp.include.every((x) => at(x) === p) && !exp.exclude.some((x) => at(x) === p);
    if (pass) ok++;
    const miss = exp.include.filter((x) => at(x) !== p).map((x) => r.parts[at(x)]?.name);
    const extra = exp.exclude.filter((x) => at(x) === p).length;
    console.log(pass ? 'OK ' : 'ERR', exp.name, '→', r.parts[p]?.name, miss.length ? `faltam ${miss.join(', ')}` : '', extra ? `sobram ${extra}` : '');
  }
  const line = `${new Date().toISOString()} import do app: ${ok}/${FIGURE_PARTS.length} partes inteiras, ${r.parts.length} partes, ${r.ms} ms`;
  console.log(line, r.parts.map((p) => `${p.name} ${(p.share * 100).toFixed(0)}%`).join(' | '));
  fs.appendFileSync(`${LAB}/partmap-scores.txt`, line + '\n');
});
