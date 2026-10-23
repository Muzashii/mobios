import type { Manifold, Mat4 } from 'manifold-3d';
import { faceSection } from './cut';
import { planeFrame, translation } from './math';
import { placeConnectors } from './placement';
import type { ConnectorParams, ConnectorType, Plane, SphereBounds, Technology, Vec2 } from './types';
import type { Wasm } from './wasm';

export const TOLERANCE_PRESETS: Record<Technology, { clearance: number; range: [number, number]; label: string }> = {
  FDM: { clearance: 0.25, range: [0.2, 0.3], label: 'FDM' },
  RESINA: { clearance: 0.12, range: [0.1, 0.15], label: 'Resina' },
};

export function defaultConnectorParams(tech: Technology): ConnectorParams {
  return {
    diameter: 5,
    depth: 6,
    clearance: TOLERANCE_PRESETS[tech].clearance,
    chamfer: 0.5,
    minWall: tech === 'FDM' ? 1.6 : 1.2,
    count: 'auto',
    maleSide: 'a',
  };
}

const SEGMENTS = 48;

/** Cylinder along +Z from z0 to z1 with optional chamfers (radius shrinks by `c0` / `c1` at the ends). */
function chamferedCylinder(wasm: Wasm, r: number, z0: number, z1: number, c0 = 0, c1 = 0): Manifold {
  const pieces: Manifold[] = [];
  const h = z1 - z0;
  c0 = Math.min(c0, h * 0.3, r * 0.45);
  c1 = Math.min(c1, h * 0.3, r * 0.45);
  const body = wasm.Manifold.cylinder(h - c0 - c1, r, r, SEGMENTS).translate([0, 0, z0 + c0]);
  pieces.push(body);
  if (c0 > 0) pieces.push(wasm.Manifold.cylinder(c0 + 1e-4, r - c0, r, SEGMENTS).translate([0, 0, z0]));
  if (c1 > 0) pieces.push(wasm.Manifold.cylinder(c1 + 1e-4, r, r - c1, SEGMENTS).translate([0, 0, z1 - c1 - 1e-4]));
  if (pieces.length === 1) return body;
  const out = wasm.Manifold.union(pieces);
  pieces.forEach((p) => p.delete());
  return out;
}

/** Hole along +Z with a flared (chamfered) entrance at z = 0. */
function hole(wasm: Wasm, r: number, depth: number, chamfer: number, below = 0.2): Manifold {
  const shaft = wasm.Manifold.cylinder(depth + below, r, r, SEGMENTS).translate([0, 0, -below]);
  if (chamfer <= 0) return shaft;
  const flare = wasm.Manifold.cylinder(chamfer + below, r + chamfer + below, r, SEGMENTS).translate([0, 0, -below]);
  const out = shaft.add(flare);
  shaft.delete();
  flare.delete();
  return out;
}

/** Fraction of `probe` inside `solid` (1 = fully contained). */
function containment(solid: Manifold, probe: Manifold): number {
  const inter = solid.intersect(probe);
  const ratio = inter.volume() / Math.max(probe.volume(), 1e-9);
  inter.delete();
  return ratio;
}

export interface ConnectorResult {
  a: Manifold;
  b: Manifold;
  /** Loose pins (dowel type), already in assembled position. */
  pins?: Manifold;
  placed: number;
  warnings: string[];
}

export interface JointGeometry {
  plane: Plane;
  bounded?: SphereBounds;
}

/** Islands of the cut face in plane-local 2D coordinates. */
export function jointFaceIslands(b: Manifold, joint: JointGeometry) {
  const frame = planeFrame(joint.plane);
  const section = faceSection(b, frame.toLocal);
  const islands = section.decompose().map((cs) => {
    const polys = cs.toPolygons() as Vec2[][];
    const area = cs.area();
    cs.delete();
    return { polys, area };
  });
  section.delete();
  return { frame, islands };
}

/**
 * Adds connectors across a joint. Never lets a hole break through a wall:
 * each pin is validated by containment and shortened or dropped if needed.
 */
export function applyConnector(
  wasm: Wasm,
  a: Manifold,
  b: Manifold,
  joint: JointGeometry,
  type: ConnectorType,
  p: ConnectorParams,
): ConnectorResult {
  const warnings: string[] = [];
  const { islands } = jointFaceIslands(b, joint);
  if (islands.length === 0) throw new Error('Face de corte não encontrada para este encaixe.');

  const r = p.diameter / 2;
  const rh = r + p.clearance;
  const keepout = rh + p.chamfer + p.minWall;
  const centers: Vec2[] = [];
  for (const island of islands) {
    const placed = placeConnectors(island.polys, { keepout, count: p.count });
    if (placed.length === 0) warnings.push(`Uma face (${island.area.toFixed(0)} mm²) é pequena demais para um pino de ${p.diameter} mm.`);
    centers.push(...placed);
  }

  // Work in a frame where the male side (or side "a" for dowels) is below z = 0.
  const flip = type === 'pin' && p.maleSide === 'b';
  const frame = planeFrame(joint.plane, flip);
  const toWorld = (m: Manifold, c: Vec2): Manifold => {
    const t = m.transform(translation([c[0], c[1], 0]));
    const w = t.transform(frame.toWorld as Mat4);
    t.delete();
    m.delete();
    return w;
  };
  // Islands were computed with the unflipped frame; mirror X/Y consistently.
  const base = planeFrame(joint.plane);
  const toFrame = (c: Vec2): Vec2 => {
    if (!flip) return c;
    const w = [
      base.origin[0] + base.u[0] * c[0] + base.v[0] * c[1],
      base.origin[1] + base.u[1] * c[0] + base.v[1] * c[1],
      base.origin[2] + base.u[2] * c[0] + base.v[2] * c[1],
    ];
    const d = [w[0] - frame.origin[0], w[1] - frame.origin[1], w[2] - frame.origin[2]];
    return [
      d[0] * frame.u[0] + d[1] * frame.u[1] + d[2] * frame.u[2],
      d[0] * frame.v[0] + d[1] * frame.v[1] + d[2] * frame.v[2],
    ];
  };

  const lower = flip ? b : a; // solid at z < 0 in `frame`
  const upper = flip ? a : b; // solid at z > 0
  const adds: Manifold[] = [];
  const upperCuts: Manifold[] = [];
  const lowerCuts: Manifold[] = [];
  const pins: Manifold[] = [];
  let placed = 0;

  for (const c0 of centers) {
    const c = toFrame(c0);
    let depth = p.depth;
    let ok = false;
    for (let attempt = 0; attempt < 4 && depth >= Math.max(1.5, p.diameter * 0.4); attempt++) {
      const probeUp = toWorld(wasm.Manifold.cylinder(depth + p.clearance + p.minWall, rh + p.minWall, rh + p.minWall, 32), c);
      const upOk = containment(upper, probeUp) > 0.985;
      probeUp.delete();
      // A male pin only needs its short embed below; a dowel needs a full hole on both sides.
      const downDepth = type === 'dowel' ? depth + p.clearance + p.minWall : Math.min(1, depth * 0.25) + p.minWall;
      const probeDown = toWorld(
        wasm.Manifold.cylinder(downDepth, rh + p.minWall, rh + p.minWall, 32).translate([0, 0, -downDepth]),
        c,
      );
      const downOk = containment(lower, probeDown) > 0.985;
      probeDown.delete();
      if (upOk && downOk) { ok = true; break; }
      depth *= 0.75;
    }
    if (!ok) {
      warnings.push('Um pino foi descartado: atravessaria a parede da peça.');
      continue;
    }
    if (depth < p.depth - 1e-6) warnings.push(`Profundidade reduzida para ${depth.toFixed(1)} mm para não furar a parede.`);
    placed++;
    const embed = Math.min(1, depth * 0.25);
    if (type === 'pin') {
      adds.push(toWorld(chamferedCylinder(wasm, r, -embed, depth, 0, p.chamfer), c));
      upperCuts.push(toWorld(hole(wasm, rh, depth + p.clearance, p.chamfer), c));
    } else {
      upperCuts.push(toWorld(hole(wasm, rh, depth + p.clearance, p.chamfer), c));
      const down = hole(wasm, rh, depth + p.clearance, p.chamfer);
      const mirrored = down.mirror([0, 0, 1]);
      down.delete();
      lowerCuts.push(toWorld(mirrored, c));
      pins.push(toWorld(chamferedCylinder(wasm, r, -depth, depth, p.chamfer, p.chamfer), c));
    }
  }

  const unionAll = (base: Manifold, extra: Manifold[]) => {
    if (!extra.length) return base.translate([0, 0, 0]);
    const merged = wasm.Manifold.union(extra);
    const out = base.add(merged);
    merged.delete();
    return out;
  };
  const subtractAll = (base: Manifold, extra: Manifold[]) => {
    if (!extra.length) return base.translate([0, 0, 0]);
    const merged = wasm.Manifold.union(extra);
    const out = base.subtract(merged);
    merged.delete();
    return out;
  };

  const newLower = type === 'pin' ? unionAll(lower, adds) : subtractAll(lower, lowerCuts);
  const newUpper = subtractAll(upper, upperCuts);
  [...adds, ...upperCuts, ...lowerCuts].forEach((m) => m.delete());

  const result: ConnectorResult = {
    a: flip ? newUpper : newLower,
    b: flip ? newLower : newUpper,
    placed,
    warnings,
  };
  if (pins.length) {
    result.pins = wasm.Manifold.compose(pins);
    pins.forEach((m) => m.delete());
  }
  return result;
}
