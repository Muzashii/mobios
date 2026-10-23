import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifold } from 'manifold-3d';
import { expect, it } from 'vitest';
import { Engine } from '../../src/geometry/engine';
import { MeshQuery } from '../../src/geometry/mesh/bvh';
import { manifoldToMeshData, repairMesh } from '../../src/geometry/repair';
import { clearRegionContexts, regionContext, suggestRegion } from '../../src/geometry/smartcut';
import type { Bounds, Vec3 } from '../../src/geometry/types';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { parseSTL } from '../../src/io/stl';
import { cutByPlane as cutByPlaneV1 } from '../corpus/legacy/cutV1';
import { suggestSmartCut as suggestV1 } from '../corpus/legacy/smartcutV1';
import { CORPUS, type CorpusCase, type Expect } from '../corpus/synthetic';

/**
 * SmartCut corpus benchmark: top-1 / top-3 hit rate, time, and the same cases run through the
 * previous algorithm (v1: PCA plane + sphere-bounded cut) as the baseline. Writes the table to
 * docs/baseline-smartcut.md. Real models in tests/corpus/models/ (STL + .expect.json) are
 * included automatically.
 */
function passes(b: Bounds, share: number, e: Expect) {
  for (let k = 0; k < 3; k++) {
    if (e.bMin?.[k] != null && b.min[k] < e.bMin[k]!) return false;
    if (e.bMax?.[k] != null && b.max[k] > e.bMax[k]!) return false;
  }
  return share >= e.share[0] && share <= e.share[1];
}

function realCases(wasm: Wasm): CorpusCase[] {
  const dir = join(__dirname, '../corpus/models');
  if (!existsSync(dir)) return [];
  const out: CorpusCase[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.expect.json'))) {
    const spec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { file: string; parts: { name: string; category: CorpusCase['category']; seeds: Vec3[]; negSeeds?: Vec3[]; radius?: number; expect: Expect }[] };
    const buf = readFileSync(join(dir, spec.file));
    spec.parts.forEach((p, i) =>
      out.push({
        id: `${spec.file}#${i}`,
        name: `${spec.file} — ${p.name}`,
        category: p.category,
        seeds: p.seeds,
        negSeeds: p.negSeeds,
        radius: p.radius ?? 4,
        expect: p.expect,
        build: () => repairMesh(wasm, parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)).manifold,
      }),
    );
  }
  return out;
}

/** Seeds arrive as surface hits in the app: snap the authored points onto the surface. */
function snap(m: Manifold, pts: Vec3[]) {
  const q = new MeshQuery(manifoldToMeshData(m));
  const out = pts.map((p) => q.closest(p)?.point ?? p);
  q.dispose();
  return out;
}

it('SmartCut corpus: v2 vs v1 baseline', async () => {
  const wasm = await loadManifold();
  const cases = [...CORPUS, ...realCases(wasm)];
  const rows: { c: CorpusCase; top1: boolean; top3: boolean; v1: boolean; ms: number; msCut: number; tris: number; note: string }[] = [];
  for (const c of cases) {
    clearRegionContexts();
    const solid = c.build(wasm);
    const total = solid.volume();
    const seeds = snap(solid, c.seeds);
    const neg = c.negSeeds ? snap(solid, c.negSeeds) : undefined;
    let top1 = false, top3 = false, note = '', ms = 0, msCut = 0;
    try {
      const t0 = performance.now();
      const s = suggestRegion(regionContext(solid, 'suggest'), seeds, c.radius, { negSeeds: neg });
      ms = performance.now() - t0;
      const engine = new Engine(wasm);
      engine.addSource('s', solid.translate([0, 0, 0]));
      s.candidates.forEach((cand, i) => {
        const t1 = performance.now();
        const r = engine.evaluate([{ id: 's', name: 'x' }], [{ kind: 'cut-region', id: `c${i}`, target: 's', balls: s.balls, seeds, negSeeds: neg, level: cand.level, mode: 'auto', plane: cand.plane }]);
        if (i === 0) msCut = performance.now() - t1;
        const b = r.parts.find((p) => p.id === `c${i}.b`);
        const ok = !!b && !r.reports[`c${i}`].error && passes(b.stats.bounds, b.stats.volume / total, c.expect);
        if (i === 0) {
          top1 = ok;
          if (!ok) note = r.reports[`c${i}`].error ?? (b ? `B: z ${b.stats.bounds.min[2].toFixed(0)}–${b.stats.bounds.max[2].toFixed(0)}, ${((b.stats.volume / total) * 100).toFixed(1)}%` : 'sem B');
          if (ok && r.reports[`c${i}`].warnings.length) note = r.reports[`c${i}`].warnings[0];
        }
        if (ok) top3 = true;
      });
      engine.dispose();
    } catch (e) {
      note = (e as Error).message;
    }
    // v1 baseline: suggestion plane + sphere-bounded plane cut, as the old app did.
    let v1 = false;
    try {
      const box = solid.boundingBox();
      const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
      const dense = solid.numTri() < 150_000 ? solid.refineToLength(diag / 120) : null;
      const s1 = suggestV1(manifoldToMeshData(dense ?? solid), seeds, c.radius);
      dense?.delete();
      const { a, b } = cutByPlaneV1(wasm, solid, s1.plane, { center: s1.plane.origin, radius: s1.radius });
      const bb = b.boundingBox();
      v1 = passes({ min: [...bb.min], max: [...bb.max] }, b.volume() / total, c.expect);
      a.delete();
      b.delete();
    } catch {
      v1 = false;
    }
    rows.push({ c, top1, top3, v1, ms, msCut, tris: solid.numTri(), note });
    solid.delete();
  }

  const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
  const n1 = rows.filter((r) => r.top1).length, n3 = rows.filter((r) => r.top3).length, nv1 = rows.filter((r) => r.v1).length;
  const lines = [
    '# SmartCut — corpus e linha de base',
    '',
    `Gerado por \`npm run bench\` (tests/bench/smartcut.corpus.test.ts). ${rows.length} casos (${CORPUS.length} modelados em tests/corpus/synthetic.ts + ${rows.length - CORPUS.length} reais em tests/corpus/models/).`,
    '',
    `| Métrica | v1 (plano PCA + esfera) | v2 (região + min-cut) |`,
    `|---|---|---|`,
    `| Acerto 1ª sugestão | ${pct(nv1)} (${nv1}/${rows.length}) | ${pct(n1)} (${n1}/${rows.length}) |`,
    `| Acerto entre as 3 primeiras | — | ${pct(n3)} (${n3}/${rows.length}) |`,
    '',
    '| Caso | Categoria | Triângulos | v1 | v2 top-1 | v2 top-3 | Sugestão (ms) | Corte (ms) | Observação |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.c.name} | ${r.c.category} | ${r.tris.toLocaleString('pt-BR')} | ${r.v1 ? '✓' : '✗'} | ${r.top1 ? '✓' : '✗'} | ${r.top3 ? '✓' : '✗'} | ${r.ms.toFixed(0)} | ${r.msCut.toFixed(0)} | ${r.note.replace(/\|/g, '/')} |`),
    '',
    'Critério: a peça B precisa ficar dentro dos limites esperados (caixa e fração de volume) e conter as sementes. Casos de **cabelo** e **roupa** dependem de linhas de vinco/degrau e da segmentação visual (Fase D2), ainda não implementadas — falham de propósito até lá.',
    '',
  ];
  writeFileSync(join(__dirname, '../../docs/baseline-smartcut.md'), lines.join('\n'));
  console.log(lines.join('\n'));
  // Regression floor (raise it as the corpus improves).
  expect(n1 / rows.length).toBeGreaterThanOrEqual(0.6);
}, 600_000);
