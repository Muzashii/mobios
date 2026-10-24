import fs from 'node:fs';
import { it } from 'vitest';
import { meshDataToManifold } from '../../src/geometry/repair';
import { regionContext, suggestRegion } from '../../src/geometry/smartcut';
import type { Vec3 } from '../../src/geometry/types';
import { loadManifold } from '../../src/geometry/wasm';
import { FIGURE_PARTS, hasLab, picker, readMesh } from './common';

/**
 * Baseline: SmartCut v2 hover (best candidate) on the same probes as the part map. A probe point
 * counts as inside the suggested piece when a vertex of the preview lies within 1 mm of it.
 */
it.skipIf(!hasLab)('SmartCut v2 on the test figure', async () => {
  const wasm = await loadManifold();
  const pick = picker(readMesh('full'));
  const m = meshDataToManifold(wasm, readMesh('full'));
  const ctx = regionContext(m, 'suggest');
  let ok = 0;
  for (const exp of FIGURE_PARTS) {
    const seed = pick(...exp.click)?.point;
    if (!seed) continue;
    let soup: Float32Array;
    try {
      soup = suggestRegion(ctx, [seed], 3, { maxCandidates: 1 }).candidates[0].preview;
    } catch {
      console.log('ERR', exp.name, 'sem sugestão');
      continue;
    }
    const inside = (ray: [Vec3, Vec3]) => {
      const p = pick(...ray)?.point;
      if (!p) return false;
      for (let i = 0; i < soup.length; i += 3) if ((soup[i] - p[0]) ** 2 + (soup[i + 1] - p[1]) ** 2 + (soup[i + 2] - p[2]) ** 2 < 1) return true;
      return false;
    };
    const missing = exp.include.filter((r) => !inside(r)).length;
    const extra = exp.exclude.filter(inside).length;
    if (!missing && !extra) ok++;
    console.log(!missing && !extra ? 'OK ' : 'ERR', exp.name.padEnd(15), missing ? `faltam ${missing}` : '', extra ? `sobram ${extra}` : '');
  }
  const line = `${new Date().toISOString()} SmartCut v2: ${ok}/${FIGURE_PARTS.length} partes inteiras`;
  console.log(line);
  fs.appendFileSync('.lab/partmap-scores.txt', line + '\n');
});
