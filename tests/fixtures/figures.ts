import type { Manifold } from 'manifold-3d';
import { exampleFigure } from '../../src/geometry/primitives';
import type { Vec3 } from '../../src/geometry/types';
import type { Wasm } from '../../src/geometry/wasm';

export interface FigureCase {
  name: string;
  build: (wasm: Wasm) => Manifold;
  seeds: Vec3[];
  seedRadius: number;
  /** Where a correct cut lands: centre within `tolerance` of `joint`, normal along `axis`. */
  joint: Vec3;
  tolerance: number;
  axis: Vec3;
}

const union = (wasm: Wasm, parts: Manifold[]) => {
  const out = wasm.Manifold.union(parts);
  parts.forEach((p) => p.delete());
  return out;
};

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const armDir = (() => {
  const d: Vec3 = [17, 0, -24];
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l] as Vec3;
})();

/** Five test figures with known joints (SPEC §10, Fase 5 acceptance). */
export const FIGURES: FigureCase[] = [
  {
    name: 'figura: braço pincelado → ombro',
    build: (w) => exampleFigure(w),
    // A brush stroke along the front of the arm, as the viewport sends it (surface hits + radius).
    seeds: [0.5, 0.6, 0.7, 0.8, 0.9].map((t) => {
      const c = lerp([17, 0, 76], [34, 0, 52], t);
      return [c[0], -(6 - t) + 0.05, c[2]] as Vec3;
    }),
    seedRadius: 4,
    joint: [20, 0, 72],
    tolerance: 9,
    axis: armDir,
  },
  {
    name: 'figura: topo da cabeça → pescoço',
    build: (w) => exampleFigure(w),
    seeds: [[0, 0, 111]],
    seedRadius: 5,
    joint: [0, 0, 84],
    tolerance: 7,
    axis: [0, 0, 1],
  },
  {
    name: 'haltere: esfera → barra',
    build: (w) =>
      union(w, [
        w.Manifold.sphere(12, 64).translate([25, 0, 0]),
        w.Manifold.sphere(12, 64).translate([-25, 0, 0]),
        w.Manifold.cylinder(50, 3.5, 3.5, 40).rotate([0, 90, 0]).translate([-25, 0, 0]),
      ]),
    seeds: [[37, 0, 0]],
    seedRadius: 5,
    joint: [0, 0, 0],
    tolerance: 15,
    axis: [1, 0, 0],
  },
  {
    name: 'cogumelo: chapéu → topo do caule',
    build: (w) =>
      union(w, [
        w.Manifold.cylinder(4, 20, 20, 64),
        w.Manifold.cylinder(30, 5, 5, 40).translate([0, 0, 2]),
        w.Manifold.sphere(15, 64).translate([0, 0, 38]),
      ]),
    seeds: [[0, 0, 53]],
    seedRadius: 6,
    joint: [0, 0, 26],
    tolerance: 8,
    axis: [0, 0, 1],
  },
  {
    name: 'galho em T: ponta do galho → junção',
    build: (w) =>
      union(w, [
        w.Manifold.cylinder(80, 8, 8, 48),
        w.Manifold.cylinder(40, 4, 4, 32).rotate([0, 90, 0]).translate([0, 0, 50]),
      ]),
    seeds: [[40, 0, 50]],
    seedRadius: 4,
    joint: [11, 0, 50],
    tolerance: 7,
    axis: [1, 0, 0],
  },
];
