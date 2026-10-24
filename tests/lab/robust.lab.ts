import fs from 'node:fs';
import type { Manifold } from 'manifold-3d';
import { it } from 'vitest';
import { manifoldToMeshData, meshDataToManifold } from '../../src/geometry/repair';
import { buildPartMap } from '../../src/geometry/segment/parts';
import { loadManifold } from '../../src/geometry/wasm';
import { FIGURE_PARTS, hasLab, LAB, picker, readMesh, writeLabels, writeMesh } from './common';

/**
 * Robustness: the same figure through proxies of different sizes (what different import sizes
 * or simplification settings produce). Every proxy must give whole parts. Proxies are cached in
 * .lab/rob<N>.*.
 */
const TARGETS = (process.env.TARGETS ?? '30000,45000,60000,90000').split(',').map(Number);

it.skipIf(!hasLab)('part map is stable across proxies', async () => {
  const wasm = await loadManifold();
  let m: Manifold | null = null;
  const lines: string[] = [];
  for (const target of TARGETS) {
    const name = `rob${target}`;
    if (!fs.existsSync(`${LAB}/${name}.pos.bin`)) {
      m ??= meshDataToManifold(wasm, readMesh('full'));
      const box = m.boundingBox();
      const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
      let work: Manifold = m;
      for (let tol = diag * 2e-4; tol < diag * 0.05 && work.numTri() > target; tol *= 1.3) {
        const s = work.simplify(tol);
        if (work !== m) work.delete();
        work = s;
      }
      writeMesh(name, manifoldToMeshData(work));
      if (work !== m) work.delete();
    }
    const mesh = readMesh(name);
    const t = performance.now();
    const map = buildPartMap(mesh);
    const ms = performance.now() - t;
    const pick = picker(mesh);
    const at = (ray: (typeof FIGURE_PARTS)[number]['click']) => { const h = pick(...ray); return h ? map.facePart[h.face] : -1; };
    const fails: string[] = [];
    for (const exp of FIGURE_PARTS) {
      const p = at(exp.click);
      if (!(p >= 0 && exp.include.every((x) => at(x) === p) && !exp.exclude.some((x) => at(x) === p))) fails.push(exp.name);
    }
    writeLabels(name, map.facePart);
    const line = `${name} (${mesh.indices.length / 3} faces): ${FIGURE_PARTS.length - fails.length}/${FIGURE_PARTS.length}, ${map.parts.length} partes, ${ms.toFixed(0)} ms${fails.length ? ' — falhou: ' + fails.join(', ') : ''}`;
    console.log(line);
    lines.push(line);
  }
  fs.appendFileSync(`${LAB}/partmap-scores.txt`, `${new Date().toISOString()} robustez\n${lines.map((l) => '  ' + l).join('\n')}\n`);
});
