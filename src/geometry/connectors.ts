import type { CrossSection, Manifold, Mat4 } from 'manifold-3d';
import { dropSlivers, faceSection } from './cut';
import { planeFrame, translation } from './math';
import { islandAxis, placeConnectors } from './placement';
import type { ConnectorParams, ConnectorType, Plane, SphereBounds, Technology, Vec2, Vec3 } from './types';
import type { Wasm } from './wasm';

export const TOLERANCE_PRESETS: Record<Technology, { clearance: number; range: [number, number]; label: string }> = {
  FDM: { clearance: 0.25, range: [0.2, 0.3], label: 'FDM' },
  RESINA: { clearance: 0.12, range: [0.1, 0.15], label: 'Resina' },
};

export const CONNECTOR_TYPES: { value: ConnectorType; label: string; hint: string }[] = [
  { value: 'pin', label: 'Pino cilíndrico', hint: 'O pino nasce numa parte e encaixa num furo com folga na outra.' },
  { value: 'square', label: 'Pino quadrado', hint: 'Não gira depois de encaixado.' },
  { value: 'hex', label: 'Pino hexagonal', hint: 'Não gira; entra em 6 posições.' },
  { value: 'key', label: 'Chaveta', hint: 'Pino com aba: encaixa numa única orientação.' },
  { value: 'dowel', label: 'Pino solto', hint: 'Furos nas duas partes e um pino impresso à parte — ideal para peças finas.' },
  { value: 'magnet', label: 'Ímã', hint: 'Furos para ímãs nas duas faces: parte removível. Diâmetro e altura do ímã.' },
  { value: 'dovetail', label: 'Rabo-de-andorinha', hint: 'Trilho deslizante atravessando a face — bases e cenários.' },
];

/** Types with a male peg and a female socket. */
const PEG: ConnectorType[] = ['pin', 'square', 'hex', 'key'];
export const hasMaleSide = (t: ConnectorType) => PEG.includes(t) || t === 'dovetail';

export function defaultConnectorParams(tech: Technology, type: ConnectorType = 'pin'): ConnectorParams {
  const base: ConnectorParams = {
    diameter: 5,
    depth: 6,
    clearance: TOLERANCE_PRESETS[tech].clearance,
    chamfer: 0.5,
    minWall: tech === 'FDM' ? 1.6 : 1.2,
    count: 'auto',
    maleSide: 'a',
  };
  if (type === 'magnet') return { ...base, diameter: 6, depth: 3, clearance: tech === 'FDM' ? 0.15 : 0.1, chamfer: 0.3 };
  if (type === 'dovetail') return { ...base, diameter: 8, depth: 4, count: 1 };
  return base;
}

const SEG = 48;
const COS30 = Math.cos(Math.PI / 6);

/** Cross-section of the male peg, centred at the origin (diameter = across flats). */
function maleProfile(wasm: Wasm, type: ConnectorType, d: number): CrossSection {
  const CS = wasm.CrossSection;
  switch (type) {
    case 'square':
      return CS.square([d, d], true);
    case 'hex':
      return CS.circle(d / 2 / COS30, 6);
    case 'key': {
      const c = CS.circle(d / 2, SEG);
      const tab = CS.square([d * 0.62, d * 0.36], true).translate([d * 0.35, 0]);
      const out = c.add(tab);
      c.delete();
      tab.delete();
      return out;
    }
    default:
      return CS.circle(d / 2, SEG);
  }
}

/** Distance from the centre to the farthest point of the male profile. */
function outerRadius(type: ConnectorType, d: number) {
  switch (type) {
    case 'square':
      return (d / 2) * Math.SQRT2;
    case 'hex':
      return d / 2 / COS30;
    case 'key':
      return Math.hypot(d * 0.66, d * 0.18);
    default:
      return d / 2;
  }
}

/** Extrudes a profile from z0 to z1, tapering the last `chamferTop` mm towards the centre. */
function prism(cs: CrossSection, z0: number, z1: number, chamferTop = 0, outer = 1): Manifold {
  const h = z1 - z0;
  const ch = Math.min(chamferTop, h * 0.3, outer * 0.45);
  if (ch <= 0) return cs.extrude(h).translate([0, 0, z0]);
  const body = cs.extrude(h - ch).translate([0, 0, z0]);
  const scale = Math.max(0.3, (outer - ch) / outer);
  const tip = cs.extrude(ch + 1e-4, 0, 0, [scale, scale]).translate([0, 0, z1 - ch - 1e-4]);
  const out = body.add(tip);
  body.delete();
  tip.delete();
  return out;
}

/** Socket: profile grown by the clearance, plus a flared entrance at z = 0. */
function socket(cs: CrossSection, depth: number, clearance: number, chamfer: number, outer: number): Manifold {
  const grown = cs.offset(clearance, 'Round', 2, SEG);
  const below = 0.2;
  const shaft = grown.extrude(depth + below).translate([0, 0, -below]);
  if (chamfer <= 0) {
    grown.delete();
    return shaft;
  }
  const flareCs = cs.offset(clearance + chamfer, 'Round', 2, SEG);
  const ro = outer + clearance + chamfer;
  const s = (outer + clearance) / ro;
  const flare = flareCs.extrude(chamfer + below, 0, 0, [s, s]).translate([0, 0, -below]);
  const out = shaft.add(flare);
  [grown, flareCs, shaft, flare].forEach((m) => m.delete());
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
  /** World direction B slides off A (normal, or the rail axis for dovetails). */
  insertDir: Vec3;
  /** Footprints on the face in plane-frame 2D (for label placement). */
  obstacles: { c: Vec2; r: number }[];
  /** Largest overlap found while sweeping B along insertDir (mm³). */
  sweepOverlap: number;
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

const unionAll = (wasm: Wasm, base: Manifold, extra: Manifold[]) => {
  if (!extra.length) return base.translate([0, 0, 0]);
  const merged = wasm.Manifold.union(extra);
  const out = dropSlivers(wasm, base.add(merged));
  merged.delete();
  return out;
};
const subtractAll = (wasm: Wasm, base: Manifold, extra: Manifold[]) => {
  if (!extra.length) return base.translate([0, 0, 0]);
  const merged = wasm.Manifold.union(extra);
  const out = dropSlivers(wasm, base.subtract(merged));
  merged.delete();
  return out;
};

/**
 * Assembly check: sweeps B along `dir` from `travel` back to the assembled position and
 * returns the largest overlap with A. Done on the joint neighbourhood only (fast).
 */
export function sweepOverlap(a: Manifold, b: Manifold, dir: Vec3, travel: number, region: Manifold): number {
  const la = a.intersect(region), lb = b.intersect(region);
  let worst = 0;
  for (const f of [1, 0.75, 0.5, 0.3, 0.15, 0.05, 0]) {
    const moved = lb.translate([dir[0] * travel * f, dir[1] * travel * f, dir[2] * travel * f]);
    const inter = la.intersect(moved);
    worst = Math.max(worst, inter.volume());
    inter.delete();
    moved.delete();
  }
  la.delete();
  lb.delete();
  return worst;
}

/**
 * Adds connectors across a joint. Never lets a socket break through a wall: each one is
 * validated by containment and shortened or dropped. Also verifies the parts can be
 * assembled along the insertion direction without collisions.
 */
export function applyConnector(wasm: Wasm, a: Manifold, b: Manifold, joint: JointGeometry, type: ConnectorType, p: ConnectorParams): ConnectorResult {
  const { islands, frame } = jointFaceIslands(b, joint);
  if (islands.length === 0) throw new Error('Face de corte não encontrada para este encaixe.');
  const res = type === 'dovetail' ? dovetail(wasm, a, b, islands, frame, p) : pegs(wasm, a, b, islands, frame, type, p);

  // Neighbourhood box around the face for the sweep check.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const isl of islands) for (const poly of isl.polys) for (const [x, y] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const travel = (type === 'dovetail' ? Math.hypot(maxX - minX, maxY - minY) : p.depth + p.clearance) + 2;
  const pad = travel + p.depth + 4;
  const cube = wasm.Manifold.cube([maxX - minX + 2 * pad, maxY - minY + 2 * pad, 2 * pad]);
  const local = cube.translate([minX - pad, minY - pad, -pad]);
  const box = local.transform(frame.toWorld as Mat4);
  cube.delete();
  local.delete();
  res.sweepOverlap = res.placed ? sweepOverlap(res.a, res.b, res.insertDir, travel, box) : 0;
  box.delete();
  return res;
}

type Islands = ReturnType<typeof jointFaceIslands>['islands'];
type Frame = ReturnType<typeof planeFrame>;

function pegs(wasm: Wasm, a: Manifold, b: Manifold, islands: Islands, frame: Frame, type: ConnectorType, p: ConnectorParams): ConnectorResult {
  const warnings: string[] = [];
  const isMagnet = type === 'magnet', isDowel = type === 'dowel';
  const both = isMagnet || isDowel; // sockets on both sides
  const profileType: ConnectorType = both ? 'pin' : type;
  const outer = outerRadius(profileType, p.diameter);
  const keepout = outer + p.clearance + p.chamfer + p.minWall;
  const centers: Vec2[] = [];
  for (const island of islands) {
    const placed = placeConnectors(island.polys, { keepout, count: p.count });
    if (placed.length === 0) warnings.push(`Uma face (${island.area.toFixed(0)} mm²) é pequena demais para este encaixe de ${p.diameter} mm.`);
    centers.push(...placed);
  }

  // Built as if the male were on A (z < 0); mirrored when it lives on B.
  const flip = !both && p.maleSide === 'b';
  const male = flip ? b : a;
  const female = flip ? a : b;
  const place = (m: Manifold, c: Vec2): Manifold => {
    const mirrored = flip ? m.mirror([0, 0, 1]) : m;
    if (flip) m.delete();
    const t = mirrored.transform(translation([c[0], c[1], 0]));
    mirrored.delete();
    const w = t.transform(frame.toWorld as Mat4);
    t.delete();
    return w;
  };
  const probeCyl = (r: number, z0: number, z1: number) => wasm.Manifold.cylinder(z1 - z0, r, r, 32).translate([0, 0, z0]);

  const profile = maleProfile(wasm, profileType, p.diameter);
  const adds: Manifold[] = [], femaleCuts: Manifold[] = [], maleCuts: Manifold[] = [], pins: Manifold[] = [];
  const obstacles: { c: Vec2; r: number }[] = [];
  let placed = 0;
  const minDepth = isMagnet ? p.depth : Math.max(1.5, p.diameter * 0.4);

  for (const c of centers) {
    let depth = p.depth;
    let ok = false;
    for (let attempt = 0; attempt < 4 && depth >= minDepth - 1e-9; attempt++) {
      const wallR = outer + p.clearance + p.minWall;
      const up = place(probeCyl(wallR, 0, depth + p.clearance + p.minWall), c);
      const upOk = containment(female, up) > 0.985;
      up.delete();
      const downDepth = both ? depth + p.clearance + p.minWall : Math.min(1, depth * 0.25) + p.minWall;
      const down = place(probeCyl(wallR, -downDepth, 0), c);
      const downOk = containment(male, down) > 0.985;
      down.delete();
      if (upOk && downOk) { ok = true; break; }
      if (isMagnet) break; // a magnet has a fixed height
      depth *= 0.75;
    }
    if (!ok) {
      warnings.push(isMagnet ? 'Um ímã foi descartado: não há espessura para o furo.' : 'Um encaixe foi descartado: atravessaria a parede da peça.');
      continue;
    }
    if (depth < p.depth - 1e-6) warnings.push(`Profundidade reduzida para ${depth.toFixed(1)} mm para não furar a parede.`);
    placed++;
    obstacles.push({ c, r: outer + p.clearance + p.chamfer + 0.8 });
    if (isMagnet) {
      // Magnet height + glue gap on each side; no flare (magnets press-fit).
      const hole = (cs: CrossSection) => socket(cs, depth + 0.2, p.clearance, 0, outer);
      femaleCuts.push(place(hole(profile), c));
      const down = hole(profile);
      maleCuts.push(place(down.mirror([0, 0, 1]), c));
      down.delete();
    } else if (isDowel) {
      femaleCuts.push(place(socket(profile, depth + p.clearance, p.clearance, p.chamfer, outer), c));
      const down = socket(profile, depth + p.clearance, p.clearance, p.chamfer, outer);
      maleCuts.push(place(down.mirror([0, 0, 1]), c));
      down.delete();
      const half = prism(profile, 0, depth, p.chamfer, outer);
      const other = half.mirror([0, 0, 1]);
      pins.push(place(half.add(other), c));
      half.delete();
      other.delete();
    } else {
      const embed = Math.min(1, depth * 0.25);
      adds.push(place(prism(profile, -embed, depth, p.chamfer, outer), c));
      femaleCuts.push(place(socket(profile, depth + p.clearance, p.clearance, p.chamfer, outer), c));
    }
  }
  profile.delete();

  const newMale = adds.length ? unionAll(wasm, male, adds) : subtractAll(wasm, male, maleCuts);
  const newFemale = subtractAll(wasm, female, femaleCuts);
  [...adds, ...femaleCuts, ...maleCuts].forEach((m) => m.delete());
  const result: ConnectorResult = {
    a: flip ? newFemale : newMale,
    b: flip ? newMale : newFemale,
    placed,
    warnings,
    insertDir: [...frame.n] as Vec3,
    obstacles,
    sweepOverlap: 0,
  };
  if (pins.length) {
    result.pins = wasm.Manifold.compose(pins);
    pins.forEach((m) => m.delete());
  }
  return result;
}

/** Sliding dovetail rail along the longest direction of each face island. */
function dovetail(wasm: Wasm, a: Manifold, b: Manifold, islands: Islands, frame: Frame, p: ConnectorParams): ConnectorResult {
  const warnings: string[] = [];
  const flip = p.maleSide === 'b';
  const male = flip ? b : a;
  const female = flip ? a : b;
  const w = p.diameter, wTop = w * 1.5;
  const rails: Manifold[] = [], slots: Manifold[] = [];
  const obstacles: { c: Vec2; r: number }[] = [];
  let axisWorld: Vec3 = [...frame.u] as Vec3;
  let placed = 0;

  for (const island of islands) {
    const [c] = placeConnectors(island.polys, { keepout: wTop / 2 + p.clearance + p.minWall, count: 1 });
    if (!c) {
      warnings.push(`Uma face (${island.area.toFixed(0)} mm²) é estreita demais para um rabo-de-andorinha de ${w} mm.`);
      continue;
    }
    const ax = islandAxis(island.polys);
    let lo = Infinity, hi = -Infinity;
    for (const poly of island.polys) for (const [x, y] of poly) {
      const t = (x - c[0]) * ax[0] + (y - c[1]) * ax[1];
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    const len = hi - lo + 4;
    const mid: Vec2 = [c[0] + ax[0] * (lo + hi) / 2, c[1] + ax[1] * (lo + hi) / 2];
    // Local prism: X across the rail, Y along the normal, Z along the rail axis.
    const toFrame: Mat4 = [-ax[1], ax[0], 0, 0, 0, 0, 1, 0, ax[0], ax[1], 0, 0, mid[0], mid[1], 0, 1];
    const place = (m: Manifold) => {
      const mirrored = flip ? m.mirror([0, 0, 1]) : m;
      const local = mirrored.transform(toFrame);
      if (flip) mirrored.delete();
      m.delete();
      const world = local.transform(frame.toWorld as Mat4);
      local.delete();
      return world;
    };
    const trapezoid = (grow: number, h: number, below: number) =>
      new wasm.CrossSection([[[-w / 2 - grow, -below], [w / 2 + grow, -below], [wTop / 2 + grow, h + grow], [-wTop / 2 - grow, h + grow]]], 'Positive');

    let h = p.depth;
    let ok = false;
    for (let attempt = 0; attempt < 4 && h >= 1.5; attempt++) {
      // Wall check on the middle 60% of the rail (its ends legitimately exit the part).
      const cs = trapezoid(p.clearance + p.minWall, h, 0);
      const probe = place(cs.extrude(len * 0.6 - 4, 0, 0, [1, 1], true));
      cs.delete();
      ok = containment(female, probe) > 0.97;
      probe.delete();
      if (ok) break;
      h *= 0.75;
    }
    if (!ok) {
      warnings.push('Um rabo-de-andorinha foi descartado: a peça é fina demais para o trilho.');
      continue;
    }
    if (h < p.depth - 1e-6) warnings.push(`Altura do trilho reduzida para ${h.toFixed(1)} mm para não furar a parede.`);
    const railCs = trapezoid(0, h, 0.3);
    const rail = place(railCs.extrude(len, 0, 0, [1, 1], true));
    railCs.delete();
    // The rail only exists inside the other part's volume, so it never sticks out.
    rails.push(rail.intersect(female));
    rail.delete();
    const slotCs = trapezoid(p.clearance, h, 0.3);
    slots.push(place(slotCs.extrude(len + 4, 0, 0, [1, 1], true)));
    slotCs.delete();
    for (let s = lo; s <= hi; s += wTop) obstacles.push({ c: [c[0] + ax[0] * s, c[1] + ax[1] * s], r: wTop / 2 + p.clearance + 0.8 });
    axisWorld = [0, 1, 2].map((k) => frame.u[k] * ax[0] + frame.v[k] * ax[1]) as Vec3;
    placed++;
  }

  const newMale = unionAll(wasm, male, rails);
  const before = female.decompose();
  const newFemale = subtractAll(wasm, female, slots);
  const after = newFemale.decompose();
  if (after.length > before.length) warnings.push('O trilho divide a outra parte em pedaços — use um rabo-de-andorinha menor.');
  [...before, ...after, ...rails, ...slots].forEach((m) => m.delete());
  return {
    a: flip ? newFemale : newMale,
    b: flip ? newMale : newFemale,
    placed,
    warnings,
    insertDir: axisWorld,
    obstacles,
    sweepOverlap: 0,
  };
}
