import { beforeAll, describe, expect, it } from 'vitest';
import { inspectMesh } from '../../src/geometry/inspect';
import { defaultPlan, repairWithPlan } from '../../src/geometry/inspect/repairPlan';
import { volumetricRemesh } from '../../src/geometry/inspect/volumetric';
import { manifoldToMeshData } from '../../src/geometry/repair';
import { GeometryService } from '../../src/geometry/service';
import type { IssueKind, MeshData, RepairPlan } from '../../src/geometry/types';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { writeSTL } from '../../src/io/stl';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const cubeMesh = (size = 20, at: [number, number, number] = [0, 0, 0]): MeshData => {
  const m = wasm.Manifold.cube([size, size, size], true).translate(at);
  const d = manifoldToMeshData(m);
  m.delete();
  return d;
};
const merge = (...meshes: MeshData[]): MeshData => {
  const pos: number[] = [], idx: number[] = [];
  for (const m of meshes) {
    const base = pos.length / 3;
    pos.push(...m.positions);
    for (const i of m.indices) idx.push(i + base);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
};
const dropFaces = (m: MeshData, faces: number[]): MeshData => {
  const keep: number[] = [];
  for (let f = 0; f < m.indices.length / 3; f++) if (!faces.includes(f)) keep.push(m.indices[f * 3], m.indices[f * 3 + 1], m.indices[f * 3 + 2]);
  return { positions: m.positions, indices: Uint32Array.from(keep) };
};
const flip = (m: MeshData, faces?: number[]): MeshData => {
  const t = Uint32Array.from(m.indices);
  for (let f = 0; f < t.length / 3; f++) if (!faces || faces.includes(f)) [t[f * 3 + 1], t[f * 3 + 2]] = [t[f * 3 + 2], t[f * 3 + 1]];
  return { positions: m.positions, indices: t };
};
/** Triangles of the cube's top face (normal +Z). */
const topFaces = (m: MeshData) => {
  const out: number[] = [];
  for (let f = 0; f < m.indices.length / 3; f++) if ([0, 1, 2].every((k) => m.positions[m.indices[f * 3 + k] * 3 + 2] > 9.99)) out.push(f);
  return out;
};
const inspect = (m: MeshData, buildVolume?: [number, number, number]) => inspectMesh('x', 'teste', m.positions, m.indices, { technology: 'FDM', buildVolume });
const kinds = (r: ReturnType<typeof inspect>) => r.issues.map((i) => i.kind);
const issue = (r: ReturnType<typeof inspect>, k: IssueKind) => r.issues.find((i) => i.kind === k);
function repair(m: MeshData, plan?: RepairPlan) {
  const r = inspect(m);
  const res = repairWithPlan(wasm, m.positions, m.indices, plan ?? defaultPlan(r.issues));
  return { report: r, ...res };
}

describe('Raio-X — diagnóstico', () => {
  it('a clean cube is "Pronta" with no repair issues', () => {
    const r = inspect(cubeMesh());
    expect(r.grade).toBe('ok');
    expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(r.volume).toBeCloseTo(8000, 0);
    expect(r.preview.positions.length).toBe(r.triangles * 9);
  });

  it('finds a hole, marks its edges and repairs it (smooth and flat)', () => {
    const c = cubeMesh();
    const holed = dropFaces(c, topFaces(c));
    const r = inspect(holed);
    const h = issue(r, 'holes')!;
    expect(h.count).toBe(1);
    expect(h.markers?.type).toBe('edges');
    expect(h.focus).toBeDefined();
    expect(r.grade).toBe('repair');
    for (const holes of ['smooth', 'flat']) {
      const { manifolds, notes } = repair(holed, { holes });
      expect(manifolds).toHaveLength(1);
      expect(manifolds[0].volume()).toBeCloseTo(8000, -1);
      expect(notes.join(' ')).toMatch(/furo/);
      manifolds.forEach((m) => m.delete());
    }
  });

  it('flipped faces and a whole inside-out shell', () => {
    const r1 = inspect(flip(cubeMesh(), [3]));
    expect(kinds(r1)).toContain('orientation');
    const r2 = inspect(flip(cubeMesh()));
    expect(issue(r2, 'orientation')!.detail).toMatch(/avesso/);
    const { manifolds } = repair(flip(cubeMesh()));
    expect(manifolds[0].volume()).toBeCloseTo(8000, 0);
    manifolds.forEach((m) => m.delete());
  });

  it('overlapping shells are united; floating debris is removed', () => {
    const tiny = cubeMesh(0.5, [60, 0, 0]);
    const m = merge(cubeMesh(20), cubeMesh(20, [10, 0, 0]), tiny);
    const r = inspect(m);
    const s = issue(r, 'shells')!;
    expect(s.detail).toMatch(/sobreposta/);
    expect(s.detail).toMatch(/sujeira/);
    expect(kinds(r)).not.toContain('self-intersections'); // only between shells
    const { manifolds, notes } = repair(m);
    expect(manifolds).toHaveLength(1);
    expect(manifolds[0].volume()).toBeCloseTo(20 * 20 * 30, -1);
    expect(notes.join(' ')).toMatch(/sujeira/);
    manifolds.forEach((x) => x.delete());
  });

  it('separate bodies can become separate parts', () => {
    const m = merge(cubeMesh(10), cubeMesh(10, [40, 0, 0]));
    const { manifolds } = repair(m, { shells: 'separate' });
    expect(manifolds).toHaveLength(2);
    manifolds.forEach((x) => x.delete());
  });

  it('an inner inverted shell is a void: kept or removed on request', () => {
    const m = merge(cubeMesh(20), flip(cubeMesh(8)));
    const r = inspect(m);
    expect(kinds(r)).toContain('inner-shells');
    const kept = repair(m, { 'inner-shells': 'keep' });
    expect(kept.manifolds[0].volume()).toBeCloseTo(8000 - 512, 0);
    const removed = repair(m, { 'inner-shells': 'remove' });
    expect(removed.manifolds[0].volume()).toBeCloseTo(8000, 0);
    [...kept.manifolds, ...removed.manifolds].forEach((x) => x.delete());
  });

  it('a fin on an edge is non-manifold and gets removed', () => {
    const c = cubeMesh(20);
    // Vertical fin standing on an outer edge of the top face (3 faces on that edge).
    const f = topFaces(c)[0];
    const P = (v: number) => [0, 1, 2].map((k) => c.positions[v * 3 + k]);
    let a = 0, b = 0;
    for (let k = 0; k < 3; k++) {
      const u = c.indices[f * 3 + k], w = c.indices[f * 3 + (k + 1) % 3];
      if (P(u).filter((x, i) => x !== P(w)[i]).length === 1) { a = u; b = w; }
    }
    const mid = [0, 1].map((k) => (P(a)[k] + P(b)[k]) / 2);
    const pos = Float32Array.from([...c.positions, mid[0], mid[1], 25]);
    const fin: MeshData = { positions: pos, indices: Uint32Array.from([...c.indices, a, b, pos.length / 3 - 1]) };
    const r = inspect(fin);
    expect(issue(r, 'non-manifold')!.severity).toBe('critical');
    expect(r.grade).toBe('critical');
    const { manifolds } = repair(fin);
    expect(manifolds[0].status()).toBe('NoError');
    expect(manifolds[0].volume()).toBeCloseTo(8000, -1);
    manifolds.forEach((x) => x.delete());
  });

  it('self-intersections inside one shell → volumetric remesh fixes them', () => {
    const c = cubeMesh(20);
    // Push one top vertex down through the bottom: its faces cross the others.
    const pos = Float32Array.from(c.positions);
    let v = 0;
    for (let i = 0; i < pos.length / 3; i++) if (pos[i * 3 + 2] > 9 && pos[i * 3] > 9 && pos[i * 3 + 1] > 9) v = i;
    pos[v * 3 + 2] = -30;
    pos[v * 3] = -5;
    const bent: MeshData = { positions: pos, indices: c.indices };
    const r = inspect(bent);
    const si = issue(r, 'self-intersections')!;
    expect(si).toBeDefined();
    expect(si.options[0].value).toBe('volumetric');
    const { manifolds, notes } = repairWithPlan(wasm, bent.positions, bent.indices, { 'self-intersections': 'volumetric', volumetricResolution: 48 });
    expect(manifolds[0].status()).toBe('NoError');
    expect(manifolds[0].volume()).toBeGreaterThan(0);
    expect(notes.join(' ')).toMatch(/volumétrico/);
    manifolds.forEach((x) => x.delete());
  });

  it('scale, thin walls, genus and printer fit', () => {
    expect(issue(inspect(cubeMesh(0.1)), 'scale')!.options[0].value).toBe('1000');
    const plate = wasm.Manifold.cube([30, 30, 0.3], true);
    expect(kinds(inspect(manifoldToMeshData(plate)))).toContain('thin-walls');
    const ring = wasm.Manifold.cylinder(5, 15, 15, 48).subtract(wasm.Manifold.cylinder(5, 8, 8, 48));
    expect(issue(inspect(manifoldToMeshData(ring)), 'genus')!.count).toBe(1);
    expect(kinds(inspect(cubeMesh(400), [256, 256, 256]))).toContain('fit');
    const tinyScaled = repair(cubeMesh(0.1), { scale: '1000' });
    expect(tinyScaled.manifolds[0].volume()).toBeCloseTo(1e6, -3);
    [plate, ring, ...tinyScaled.manifolds].forEach((x) => x.delete());
  });

  it('volumetric remesh closes a holed cube', () => {
    const { manifold, voxel } = volumetricRemesh(wasm, dropFaces(cubeMesh(20), [0]), 64);
    expect(manifold.status()).toBe('NoError');
    expect(Math.abs(manifold.volume() - 8000) / 8000).toBeLessThan(0.08);
    expect(voxel).toBeCloseTo(20 / 64, 3);
    manifold.delete();
  });
});

describe('Raio-X — fluxo de importação no serviço', () => {
  it('inspect → finish registers the repaired source; nothing changes before', () => {
    const svc = new GeometryService(wasm);
    const cube = cubeMesh(20);
    const holed = dropFaces(cube, topFaces(cube));
    const soup = new Float32Array(holed.indices.length * 3);
    holed.indices.forEach((v, i) => soup.set(holed.positions.subarray(v * 3, v * 3 + 3), i * 3));
    const stl = writeSTL({ positions: soup, indices: Uint32Array.from(soup.map((_, i) => i).filter((i) => i < soup.length / 3)) }, 'furado');
    const buf = stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer;
    const [report] = svc.inspectFile('furado.stl', buf, 's1', 'FDM');
    expect(svc.hasSource('s1')).toBe(false);
    expect(report.issues.some((i) => i.kind === 'holes')).toBe(true);
    const out = svc.finishImport(report.id, defaultPlan(report.issues));
    expect(svc.hasSource('s1')).toBe(true);
    expect(out.summary).toMatch(/furo/);
    expect(() => svc.finishImport(report.id, {})).toThrow(/expirada/);
    svc.engine.dispose();
  });
});
