import fs from 'node:fs';
import { it } from 'vitest';
import { partMapOf } from '../../src/geometry/partmap';
import { meshDataToManifold } from '../../src/geometry/repair';
import { loadManifold } from '../../src/geometry/wasm';
import { FIGURE_PARTS, hasLab, picker, readMesh, writeLabels, writeMesh } from './common';

/** The path the app takes: full mesh (1.9M triangles) → proxy → part map → labels per triangle. */
it.skipIf(!hasLab)('part map of the full test figure', async () => {
  const wasm = await loadManifold();
  const full = readMesh('full');
  const m = meshDataToManifold(wasm, full);
  const r = partMapOf(m, (proxy) => writeMesh('app', proxy));
  console.log('parts', r.parts.map((p) => `${p.name} ${(p.share * 100).toFixed(1)}%`).join(' | '), `${r.ms} ms`);
  // Probe on the manifold's own mesh (labels are in its order).
  const mesh = { positions: new Float32Array(0), indices: new Uint32Array(0) };
  const mm = m.getMesh();
  mesh.positions = Float32Array.from({ length: mm.numVert * 3 }, (_, i) => mm.vertProperties[Math.floor(i / 3) * mm.numProp + (i % 3)]);
  mesh.indices = Uint32Array.from(mm.triVerts);
  const pick = picker(mesh);
  let ok = 0;
  for (const exp of FIGURE_PARTS) {
    const at = (ray: (typeof exp)['click']) => { const h = pick(...ray); return h ? r.labels[h.face] : -1; };
    const p = at(exp.click);
    const pass = p >= 0 && exp.include.every((x) => at(x) === p) && !exp.exclude.some((x) => at(x) === p);
    if (pass) ok++;
    console.log(pass ? 'OK ' : 'ERR', exp.name, '→', r.parts[p]?.name);
  }
  const line = `${new Date().toISOString()} malha completa: ${ok}/${FIGURE_PARTS.length} partes inteiras, ${r.ms} ms`;
  console.log(line);
  fs.appendFileSync('.lab/partmap-scores.txt', line + '\n');
  if (process.env.SAVE) {
    fs.writeFileSync('.lab/fullm.pos.bin', Buffer.from(mesh.positions.buffer));
    fs.writeFileSync('.lab/fullm.idx.bin', Buffer.from(mesh.indices.buffer));
    writeLabels('fullm', Int32Array.from(r.labels));
  }
});
