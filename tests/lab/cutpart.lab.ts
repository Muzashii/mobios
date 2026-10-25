import fs from 'node:fs';
import { it } from 'vitest';
import { Engine } from '../../src/geometry/engine';
import { manifoldToMeshData, meshDataToManifold } from '../../src/geometry/repair';
import type { Vec3 } from '../../src/geometry/types';
import { loadManifold } from '../../src/geometry/wasm';
import { LAB, picker, readMesh, writeMesh } from './common';

/** Cuts detected parts by a click, the way SmartCut hover does: CUTS="name:x,y,z;..." from the front. */
it.skipIf(!fs.existsSync(`${LAB}/imp.pos.bin`))('cut detected parts', async () => {
  const wasm = await loadManifold();
  const mesh = readMesh('imp');
  const pick = picker(mesh);
  const cuts = (process.env.CUTS ?? 'chapeu:0,120,1;cabeca:0,8,0;braco:-16.3,-15.2,0').split(';').map((c) => {
    const [name, xyz] = c.split(':');
    const [x, z, top] = xyz.split(',').map(Number);
    const hit = top ? pick([x, 0, 200], [0, 0, -1]) : pick([x, -100, z], [0, 1, 0]);
    return { name, point: hit!.point as Vec3 };
  });
  const { boundaryLoops } = await import('../../src/geometry/segment/region');
  const { regionContext } = await import('../../src/geometry/smartcut');
  const { writeLabels } = await import('./common');
  if (process.env.DBG) (globalThis as { __dbgLog?: (...a: unknown[]) => void }).__dbgLog = (...a) => console.log('   ', ...a);
  for (const c of cuts) {
    (globalThis as { __dbgPart?: (l: Uint8Array) => void }).__dbgPart = (l) => {
      const ctx = regionContext(engine.part('fig')!, 'apply');
      try { console.log('  loops', boundaryLoops(ctx.topo, l).map((x) => x.length).join(',')); } catch (e) { console.log('  loops ERR', (e as Error).message); }
      writeMesh(`dbg_${c.name}`, ctx.mesh);
      writeLabels(`dbg_${c.name}`, Int32Array.from(l));
    };
    const engine = new Engine(wasm);
    engine.addSource('fig', meshDataToManifold(wasm, mesh));
    const t = performance.now();
    const r = engine.evaluate([{ id: 'fig', name: 'fig' }], [{ kind: 'cut-region', id: 'c1', target: 'fig', balls: [], seeds: [c.point], partSeeds: [c.point], level: 0, mode: 'auto', plane: { origin: c.point, normal: [0, 0, 1] } }]);
    const rep = r.reports.c1;
    const b = engine.part('c1.b'), a = engine.part('c1.a');
    console.log(c.name, `${(performance.now() - t).toFixed(0)} ms`, rep.error ?? '', rep.warnings.join(' '), rep.info ?? '', b ? `B ${b.volume().toFixed(0)} mm³` : '');
    if (a && b) {
      writeMesh(`cut_${c.name}_a`, manifoldToMeshData(a));
      writeMesh(`cut_${c.name}_b`, manifoldToMeshData(b));
    }
    engine.dispose();
  }
});
