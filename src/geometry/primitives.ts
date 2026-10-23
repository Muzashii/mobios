import type { Manifold } from 'manifold-3d';
import type { Technology } from './types';
import type { Wasm } from './wasm';

/** Limb between two points: cylinder with rounded joints. */
function limb(wasm: Wasm, from: [number, number, number], to: [number, number, number], r0: number, r1: number) {
  const a = wasm.Manifold.sphere(r0, 40).translate(from);
  const b = wasm.Manifold.sphere(r1, 40).translate(to);
  const hull = wasm.Manifold.hull([a, b]);
  a.delete();
  b.delete();
  return hull;
}

/** Friendly sample figure (≈ 110 mm tall) for onboarding: torso, head, arms, legs on a base. */
export function exampleFigure(wasm: Wasm): Manifold {
  const pieces: Manifold[] = [
    // Base
    wasm.Manifold.cylinder(6, 34, 32, 96).translate([0, 0, 0]),
    // Legs (feet rounded inside the base: the figure stands flat on the plate)
    limb(wasm, [-9, 0, 8], [-8, 0, 40], 7, 8),
    limb(wasm, [9, 0, 8], [8, 0, 40], 7, 8),
    // Torso and hips
    limb(wasm, [0, 0, 44], [0, 0, 72], 15, 17),
    // Neck and head
    limb(wasm, [0, 0, 80], [0, 0, 86], 5, 5),
    wasm.Manifold.sphere(13, 64).translate([0, 0, 98]),
    // Arms (shoulder to hand)
    limb(wasm, [-17, 0, 76], [-34, 0, 52], 6, 5),
    limb(wasm, [17, 0, 76], [34, 0, 52], 6, 5),
    wasm.Manifold.sphere(6.5, 40).translate([-35, 0, 50]),
    wasm.Manifold.sphere(6.5, 40).translate([35, 0, 50]),
  ];
  const fig = wasm.Manifold.union(pieces);
  pieces.forEach((p) => p.delete());
  return fig;
}

export function clearanceSteps(tech: Technology): number[] {
  return tech === 'FDM' ? [0.1, 0.15, 0.2, 0.25, 0.3] : [0.05, 0.08, 0.1, 0.12, 0.15];
}

/**
 * Tolerance test: a bar with 5 holes (increasing clearance, marked by 1–5 notches)
 * and a matching bar of 5 pins. Print both, keep the tightest hole that fits.
 */
export function calibrationPieces(wasm: Wasm, tech: Technology): { holes: Manifold; pins: Manifold } {
  const steps = clearanceSteps(tech);
  const d = 5, depth = 6, pitch = 11, w = steps.length * pitch + 4, t = 12, h = 8;
  let holes = wasm.Manifold.cube([w, t, h]).translate([-w / 2, -t / 2, 0]);
  let pins = wasm.Manifold.cube([w, t - 4, 2]).translate([-w / 2, -(t - 4) / 2, 0]);
  steps.forEach((c, i) => {
    const x = -w / 2 + 2 + pitch / 2 + i * pitch;
    const holeSolid = wasm.Manifold.cylinder(depth + 0.2, d / 2 + c, d / 2 + c, 64).translate([x, 0, h - depth]);
    const marks: Manifold[] = [];
    for (let k = 0; k <= i; k++) marks.push(wasm.Manifold.cube([0.8, 1.2, 1.2]).translate([x - 2.5 + k * 1.3, -t / 2 - 0.2, h - 1]));
    const cutters = wasm.Manifold.union([holeSolid, ...marks]);
    const next = holes.subtract(cutters);
    holes.delete();
    holes = next;
    [holeSolid, cutters, ...marks].forEach((m) => m.delete());

    const pin = wasm.Manifold.cylinder(depth, d / 2, d / 2 - 0.4, 64).translate([x, 0, 2]);
    const pinMarks: Manifold[] = [];
    for (let k = 0; k <= i; k++) pinMarks.push(wasm.Manifold.cube([0.8, 1, 0.8]).translate([x - 2.5 + k * 1.3, -(t - 4) / 2 - 0.2, 1.4]));
    const pinCut = wasm.Manifold.union(pinMarks);
    const withPin = pins.add(pin);
    const nextPins = withPin.subtract(pinCut);
    pins.delete();
    withPin.delete();
    pins = nextPins;
    [pin, pinCut, ...pinMarks].forEach((m) => m.delete());
  });
  const placedPins = pins.translate([0, t + 6, 0]);
  pins.delete();
  return { holes, pins: placedPins };
}
