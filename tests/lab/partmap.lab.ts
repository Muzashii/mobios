import fs from 'node:fs';
import { it } from 'vitest';
import { buildPartMap } from '../../src/geometry/segment/parts';
import { FIGURE_PARTS, hasLab, picker, readMesh, writeLabels } from './common';

/**
 * Stage 0 metric on the real test figure (.lab/, never committed): for each expected part, the
 * part under the click must contain every "include" point and none of the "exclude" points.
 * Appends the score to .lab/partmap-scores.txt.
 */
it.skipIf(!hasLab)('part map on the test figure', () => {
  const mesh = readMesh(process.env.MESH ?? 'p60000');
  const t = performance.now();
  const map = buildPartMap(mesh);
  const ms = performance.now() - t;
  console.log('timings', JSON.stringify(map.timings), 'regions', map.regions.length, 'parts', map.parts.length);
  for (const q of map.parts) console.log(q.id, q.name.padEnd(16), `${q.area.toFixed(0)}mm²`, `t=${q.thickness.toFixed(1)}`, q.regions.map((r) => map.regions[r].role[0] + r).join(','));
  const pick = picker(mesh);
  const partAt = (ray: [number[], number[]]) => {
    const h = pick(ray[0] as [number, number, number], ray[1] as [number, number, number]);
    return h ? map.facePart[h.face] : -1;
  };
  let ok = 0;
  for (const exp of FIGURE_PARTS) {
    const p = partAt(exp.click);
    const missing = exp.include.filter((r) => partAt(r) !== p).length;
    const extra = exp.exclude.filter((r) => partAt(r) === p).length;
    const pass = p >= 0 && !missing && !extra;
    if (pass) ok++;
    console.log(pass ? 'OK ' : 'ERR', exp.name.padEnd(15), '→', p >= 0 ? map.parts[p].name : 'nada', missing ? `faltam ${missing}` : '', extra ? `sobram ${extra}` : '');
  }
  const line = `${new Date().toISOString()} ${ok}/${FIGURE_PARTS.length} partes inteiras, ${map.parts.length} partes, ${ms.toFixed(0)} ms`;
  console.log(line);
  fs.appendFileSync('.lab/partmap-scores.txt', line + '\n');
  writeLabels('pm', map.facePart);
  writeLabels('pmr', map.faceRegion);
});
