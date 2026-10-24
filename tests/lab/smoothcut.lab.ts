import { it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import { exampleFigure } from '../../src/geometry/primitives';
import { splitRegion } from '../../src/geometry/regionCut';
import { meshDataToManifold } from '../../src/geometry/repair';
import { labelFaces, regionField } from '../../src/geometry/segment/region';
import { snapBand, regionContext, suggestRegion } from '../../src/geometry/smartcut';
import type { Vec3 } from '../../src/geometry/types';
import { loadManifold } from '../../src/geometry/wasm';
import { FIGURES } from '../fixtures/figures';
import { hasLab, picker, readMesh, writeMesh } from './common';

/** Resample a closed loop every `h` mm. */
function resample(loop: Vec3[], h: number): Vec3[] {
  const out: Vec3[] = [];
  let carry = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let s = carry;
    while (s < d) {
      const t = s / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      s += h;
    }
    carry = s - d;
  }
  return out;
}

/** Loop length / length of the same loop averaged over a 3 mm window (1 = no zigzag). */
function roughness(loop: Vec3[]) {
  const pts = resample(loop, 0.25), n = pts.length, w = 6;
  const len = (q: Vec3[]) => q.reduce((s, p, i) => s + Math.hypot(...(p.map((x, k) => x - q[(i + 1) % n][k]) as Vec3)), 0);
  const avg = pts.map((_, i) => [0, 1, 2].map((k) => { let s = 0; for (let j = -w; j <= w; j++) s += pts[(i + j + n) % n][k]; return s / (2 * w + 1); }) as Vec3);
  return len(pts) / len(avg);
}

function measure(name: string, solid: Manifold, seeds: Vec3[], radius: number, save?: string) {
  const ctx = regionContext(solid, 'apply');
  const s = suggestRegion(regionContext(solid, 'suggest'), seeds, radius);
  const field = regionField(ctx, s.balls, seeds);
  const out: string[] = [];
  for (const smooth of [false, true]) {
    try {
      // Like cutRegion: the level, then a little further or back if the cap cannot close.
      let r: ReturnType<typeof splitRegion> | null = null;
      let err: unknown;
      for (const f of [1, 1.15, 0.87, 1.3]) {
        const lv = s.candidates[0].level * f;
        try {
          r = splitRegion(ctx, labelFaces(ctx, field, lv, snapBand(ctx, lv)), { mode: 'surface', towards: field.centroid, smooth });
          break;
        } catch (e) {
          err = e;
        }
      }
      if (!r) throw err;
      const main = r.loops.reduce((x, y) => (y.length > x.length ? y : x));
      out.push(`${smooth ? 'suave' : 'antes'} ${roughness(main).toFixed(3)}`);
      if (save) { writeMesh(`${save}_${smooth ? 'suave' : 'antes'}_b`, r.b); writeMesh(`${save}_${smooth ? 'suave' : 'antes'}_a`, r.a); }
    } catch (e) {
      out.push(`${smooth ? 'suave' : 'antes'} ERRO ${(e as Error).message}`);
    }
  }
  console.log(name.slice(0, 34).padEnd(34), out.join(' | '));
}

it('cleaner joint line', async () => {
  const wasm = await loadManifold();
  const solid = exampleFigure(wasm);
  void solid;
  FIGURES.forEach((fig, i) => measure(fig.name, fig.build(wasm), fig.seeds, fig.seedRadius, `fig${i}`));
  if (hasLab) {
    const mesh = readMesh('impfull');
    const m = meshDataToManifold(wasm, mesh);
    const face = picker(mesh)([0, -100, 8], [0, 1, 0])!.point;
    measure('boneco: rosto → cabeça', m, [face], 3, 'neck');
  }
});
