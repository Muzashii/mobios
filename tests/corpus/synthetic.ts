import type { Manifold } from 'manifold-3d';
import { exampleFigure } from '../../src/geometry/primitives';
import { manifoldToMeshData, meshDataToManifold } from '../../src/geometry/repair';
import type { Vec3 } from '../../src/geometry/types';
import type { Wasm } from '../../src/geometry/wasm';

/**
 * SmartCut corpus — modelled cases with a known right answer.
 *
 * These are procedural stand-ins for the situations the plan lists (hair, clothes, arm touching
 * the body, a handle, held object, animal, wing, scan noise, coarse CAD, scale). Real downloaded
 * models go in tests/corpus/models/ with an `.expect.json` (see README.md) and are picked up by
 * the same benchmark. A case passes when part B satisfies every bound in `expect`.
 */
export type Category = 'cabeça' | 'membro' | 'mão' | 'cauda/asa' | 'cabelo' | 'roupa' | 'acessório' | 'scan' | 'cad' | 'primitiva';

export interface Expect {
  /** Lower bounds on B's bounding box (null = free). */
  bMin?: (number | null)[];
  /** Upper bounds on B's bounding box. */
  bMax?: (number | null)[];
  /** B volume / total volume range. */
  share: [number, number];
}

export interface CorpusCase {
  id: string;
  name: string;
  category: Category;
  build: (wasm: Wasm) => Manifold;
  seeds: Vec3[];
  negSeeds?: Vec3[];
  radius: number;
  expect: Expect;
}

const limb = (w: Wasm, a: Vec3, b: Vec3, r0: number, r1: number, seg = 40) => {
  const s0 = w.Manifold.sphere(r0, seg).translate(a), s1 = w.Manifold.sphere(r1, seg).translate(b);
  const h = w.Manifold.hull([s0, s1]);
  s0.delete();
  s1.delete();
  return h;
};
const union = (w: Wasm, parts: Manifold[]) => {
  const out = w.Manifold.union(parts);
  parts.forEach((p) => p.delete());
  return out;
};

/** The onboarding figure rebuilt with options (arm pose, extra pieces, segments). */
function figure(w: Wasm, o: { rightHand?: Vec3; seg?: number; extra?: (w: Wasm) => Manifold[] } = {}) {
  const seg = o.seg ?? 40;
  const hand = o.rightHand ?? [35, 0, 50];
  const elbow: Vec3 = [(17 + hand[0]) / 2 + 1, hand[1] / 2, (76 + hand[2]) / 2];
  return union(w, [
    w.Manifold.cylinder(6, 34, 32, Math.max(12, seg * 2)),
    limb(w, [-9, 0, 8], [-8, 0, 40], 7, 8, seg),
    limb(w, [9, 0, 8], [8, 0, 40], 7, 8, seg),
    limb(w, [0, 0, 44], [0, 0, 72], 15, 17, seg),
    limb(w, [0, 0, 80], [0, 0, 86], 5, 5, seg),
    w.Manifold.sphere(13, Math.max(12, seg * 1.5)).translate([0, 0, 98]),
    limb(w, [-17, 0, 76], [-34, 0, 52], 6, 5, seg),
    w.Manifold.sphere(6.5, seg).translate([-35, 0, 50]),
    limb(w, [17, 0, 76], elbow, 6, 5.5, seg),
    limb(w, elbow, [hand[0] - 1, hand[1], hand[2] + 2], 5.5, 5, seg),
    w.Manifold.sphere(6.5, seg).translate(hand),
    ...(o.extra?.(w) ?? []),
  ]);
}

const HEAD: Expect = { bMin: [null, null, 83], share: [0.05, 0.2] };

export const CORPUS: CorpusCase[] = [
  { id: 'head-top', name: 'Cabeça — clique no topo', category: 'cabeça', build: (w) => exampleFigure(w), seeds: [[0, 0, 111]], radius: 5, expect: HEAD },
  { id: 'head-front', name: 'Cabeça — clique no rosto', category: 'cabeça', build: (w) => exampleFigure(w), seeds: [[0, -13, 98]], radius: 4, expect: HEAD },
  { id: 'head-side', name: 'Cabeça — clique na lateral', category: 'cabeça', build: (w) => exampleFigure(w), seeds: [[13, 0, 99]], radius: 4, expect: HEAD },
  {
    id: 'arm-brush',
    name: 'Braço — pincelado na frente',
    category: 'membro',
    build: (w) => exampleFigure(w),
    seeds: [0.5, 0.6, 0.7, 0.8, 0.9].map((t) => [17 + 17 * t, -(6 - t) + 0.05, 76 - 24 * t] as Vec3),
    radius: 4,
    expect: { bMin: [12, null, null], share: [0.02, 0.12] },
  },
  { id: 'arm-click', name: 'Braço — clique no antebraço', category: 'membro', build: (w) => exampleFigure(w), seeds: [[28, -5.4, 62]], radius: 4, expect: { bMin: [12, null, null], share: [0.02, 0.12] } },
  { id: 'hand-click', name: 'Mão — clique na mão', category: 'mão', build: (w) => exampleFigure(w), seeds: [[-35, -6.5, 50]], radius: 3, expect: { bMax: [-26, null, null], share: [0.005, 0.05] } },
  { id: 'leg-click', name: 'Perna — clique na coxa (perna liga base e quadril)', category: 'membro', build: (w) => exampleFigure(w), seeds: [[9, -7.6, 24]], radius: 4, expect: { bMin: [0, null, 3], bMax: [null, null, 50], share: [0.03, 0.2] } },
  {
    id: 'arm-on-hip',
    name: 'Braço com a mão na cintura (forma uma alça)',
    category: 'membro',
    build: (w) => figure(w, { rightHand: [17, -3, 52] }),
    seeds: [[24, -5.5, 66]],
    radius: 4,
    expect: { bMin: [8, null, 44], share: [0.01, 0.12] },
  },
  {
    id: 'arm-near-body',
    name: 'Braço quase encostado no tronco (folga ~0,5 mm)',
    category: 'membro',
    build: (w) => figure(w, { rightHand: [23, 0, 50] }),
    seeds: [[24, -5.5, 64]],
    radius: 4,
    expect: { bMin: [12, null, 40], share: [0.01, 0.12] },
  },
  {
    id: 'sword',
    name: 'Espada na mão — separar o objeto',
    category: 'acessório',
    build: (w) => figure(w, { extra: (ww) => [ww.Manifold.cylinder(60, 1.6, 1.6, 24).rotate([90, 0, 0]).translate([35, 30, 50])] }),
    seeds: [[35, -26, 51.6]],
    radius: 2,
    expect: { bMax: [null, -6, null], share: [0.001, 0.03] },
  },
  {
    id: 'hat',
    name: 'Chapéu — separar da cabeça',
    category: 'acessório',
    build: (w) => figure(w, { extra: (ww) => [ww.Manifold.cylinder(2, 17, 17, 64).translate([0, 0, 106]), ww.Manifold.cylinder(10, 9, 8, 64).translate([0, 0, 108])] }),
    seeds: [[0, 0, 118]],
    radius: 4,
    expect: { bMin: [null, null, 103], share: [0.01, 0.15] },
  },
  {
    id: 'hair',
    name: 'Cabelo — casca sobre o crânio (linha do cabelo em z ≈ 99)',
    category: 'cabelo',
    build: (w) => figure(w, { extra: (ww) => {
      const cap = ww.Manifold.sphere(14.2, 64).translate([0, 0, 98]);
      const [above] = cap.splitByPlane([0, 0, 1], 99);
      cap.delete();
      return [above];
    } }),
    seeds: [[0, 0, 112]],
    radius: 4,
    expect: { bMin: [null, null, 97], share: [0.002, 0.06] },
  },
  {
    id: 'shirt-pants',
    name: 'Camiseta × calça — cortar na cintura (barra em z = 58)',
    category: 'roupa',
    build: (w) => figure(w, { extra: (ww) => [ww.Manifold.cylinder(16, 17.4, 18.2, 96).translate([0, 0, 58])] }),
    seeds: [[0, -18, 66]],
    negSeeds: [[0, -15.6, 49]],
    radius: 4,
    expect: { bMin: [null, null, 54], share: [0.35, 0.8] },
  },
  {
    id: 'tail',
    name: 'Quadrúpede — cauda',
    category: 'cauda/asa',
    build: (w) => quadruped(w),
    seeds: [[-64, 0, 46.5]],
    radius: 2,
    expect: { bMax: [-38, null, null], share: [0.001, 0.05] },
  },
  {
    id: 'animal-head',
    name: 'Quadrúpede — cabeça',
    category: 'cabeça',
    build: (w) => quadruped(w),
    seeds: [[49, 0, 41]],
    radius: 3,
    expect: { bMin: [30, null, null], share: [0.03, 0.25] },
  },
  {
    id: 'wing',
    name: 'Dragão — asa (placa fina)',
    category: 'cauda/asa',
    build: (w) => union(w, [quadruped(w), w.Manifold.cube([24, 40, 2.5]).translate([-12, 9, 33])]),
    seeds: [[0, 46, 35.5]],
    radius: 3,
    expect: { bMin: [null, 7, null], share: [0.01, 0.2] },
  },
  { id: 'scan-noise', name: 'Scan ruidoso (±0,08 mm) — cabeça', category: 'scan', build: (w) => noisy(w, exampleFigure(w)), seeds: [[0, -13, 98]], radius: 4, expect: HEAD },
  { id: 'cad-coarse', name: 'Malha CAD grossa (triângulos longos) — cabeça', category: 'cad', build: (w) => figure(w, { seg: 10 }), seeds: [[0, 0, 111]], radius: 5, expect: HEAD },
  {
    id: 'big-scale',
    name: 'Mesma figura em escala 10× (1,1 m) — braço',
    category: 'membro',
    build: (w) => {
      const f = exampleFigure(w);
      const s = f.scale(10);
      f.delete();
      return s;
    },
    seeds: [[280, -54, 620]],
    radius: 40,
    expect: { bMin: [120, null, null], share: [0.02, 0.12] },
  },
  {
    id: 'dumbbell',
    name: 'Haltere — esfera',
    category: 'primitiva',
    build: (w) => union(w, [w.Manifold.sphere(12, 64).translate([25, 0, 0]), w.Manifold.sphere(12, 64).translate([-25, 0, 0]), w.Manifold.cylinder(50, 3.5, 3.5, 40).rotate([0, 90, 0]).translate([-25, 0, 0])]),
    seeds: [[37, 0, 0]],
    radius: 5,
    expect: { bMin: [8, null, null], share: [0.3, 0.5] },
  },
  {
    id: 'mushroom',
    name: 'Cogumelo — chapéu',
    category: 'primitiva',
    build: (w) => union(w, [w.Manifold.cylinder(4, 20, 20, 64), w.Manifold.cylinder(30, 5, 5, 40).translate([0, 0, 2]), w.Manifold.sphere(15, 64).translate([0, 0, 38])]),
    seeds: [[0, 0, 53]],
    radius: 6,
    expect: { bMin: [null, null, 18], share: [0.4, 0.85] },
  },
  {
    id: 't-branch',
    name: 'Galho em T — ramo',
    category: 'primitiva',
    build: (w) => union(w, [w.Manifold.cylinder(80, 8, 8, 48), w.Manifold.cylinder(40, 4, 4, 32).rotate([0, 90, 0]).translate([0, 0, 50])]),
    seeds: [[40, 0, 50]],
    radius: 4,
    expect: { bMin: [6, null, null], share: [0.05, 0.2] },
  },
];

function quadruped(w: Wasm) {
  return union(w, [
    limb(w, [-30, 0, 30], [30, 0, 32], 12, 11),
    ...([[-22, -7], [-22, 7], [22, -7], [22, 7]] as [number, number][]).map(([x, y]) => limb(w, [x, y, 2], [x, y, 26], 4, 5)),
    limb(w, [36, 0, 36], [36, 0, 36], 4, 4),
    w.Manifold.sphere(9, 48).translate([44, 0, 41]),
    limb(w, [-38, 0, 32], [-64, 0, 45], 3, 1.5),
  ]);
}

/** Scanner-like noise: every vertex jittered (deterministic), on a dense mesh. */
function noisy(w: Wasm, m: Manifold) {
  const dense = m.refineToLength(0.8);
  m.delete();
  const mesh = manifoldToMeshData(dense);
  dense.delete();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < mesh.positions.length; i++) mesh.positions[i] += rnd() * 0.08;
  return meshDataToManifold(w, mesh);
}
