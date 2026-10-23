import type { Manifold } from 'manifold-3d';
import { manifoldToMeshData } from './repair';
import { rayHits } from './smartcut';
import type { MeshData, Technology, Vec3 } from './types';

export interface PrintabilityReport {
  /** Downward-facing area steeper than 45° (needs supports), excluding the base (mm²). */
  overhangArea: number;
  overhangPct: number;
  /** Area resting on the plate (mm²). */
  baseArea: number;
  height: number;
  /** Thinnest sampled wall (mm) and the share of surface thinner than the safe minimum. */
  minThickness: number;
  thinPct: number;
  thinLimit: number;
}

export interface OrientationSuggestion {
  down: Vec3;
  report: PrintabilityReport;
  current: PrintabilityReport;
  label: string;
}

const THIN: Record<Technology, number> = { FDM: 0.8, RESINA: 0.5 };
const COS45 = Math.SQRT1_2;

function faceData(mesh: MeshData) {
  const { positions: p, indices: t } = mesh;
  const n = t.length / 3;
  const normals = new Float32Array(n * 3), areas = new Float32Array(n), cent = new Float32Array(n * 3);
  let total = 0;
  for (let f = 0; f < n; f++) {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[f * 3] = nx / l; normals[f * 3 + 1] = ny / l; normals[f * 3 + 2] = nz / l;
    areas[f] = l / 2;
    total += l / 2;
    for (let k = 0; k < 3; k++) cent[f * 3 + k] = (p[a + k] + p[b + k] + p[c + k]) / 3;
  }
  return { normals, areas, cent, total };
}

/** Overhangs and base for a given "down" direction (the side that faces the build plate). */
function orientationMetrics(mesh: MeshData, fd: ReturnType<typeof faceData>, down: Vec3) {
  const p = mesh.positions;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i] * down[0] + p[i + 1] * down[1] + p[i + 2] * down[2];
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  // `hi` is the lowest point when printed (largest projection on "down").
  let overhang = 0, base = 0;
  const n = fd.areas.length;
  for (let f = 0; f < n; f++) {
    const facing = fd.normals[f * 3] * down[0] + fd.normals[f * 3 + 1] * down[1] + fd.normals[f * 3 + 2] * down[2];
    if (facing < COS45) continue;
    const h = fd.cent[f * 3] * down[0] + fd.cent[f * 3 + 1] * down[1] + fd.cent[f * 3 + 2] * down[2];
    if (hi - h < 0.3 && facing > 0.99) base += fd.areas[f];
    else overhang += fd.areas[f];
  }
  return { overhangArea: overhang, overhangPct: (overhang / fd.total) * 100, baseArea: base, height: hi - lo };
}

/** Wall thickness sampled with inward rays from ~240 area-weighted faces. */
function thickness(mesh: MeshData, fd: ReturnType<typeof faceData>, limit: number) {
  const n = fd.areas.length;
  const samples = Math.min(240, n);
  // Deterministic, area-weighted stratified sampling.
  const cumulative = new Float64Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) cumulative[f] = acc += fd.areas[f];
  let min = Infinity, thin = 0;
  let f = 0;
  for (let s = 0; s < samples; s++) {
    const target = ((s + 0.5) / samples) * acc;
    while (f < n - 1 && cumulative[f] < target) f++;
    const nrm: Vec3 = [fd.normals[f * 3], fd.normals[f * 3 + 1], fd.normals[f * 3 + 2]];
    const o: Vec3 = [fd.cent[f * 3] - nrm[0] * 1e-3, fd.cent[f * 3 + 1] - nrm[1] * 1e-3, fd.cent[f * 3 + 2] - nrm[2] * 1e-3];
    const hits = rayHits(mesh.positions, mesh.indices, o, [-nrm[0], -nrm[1], -nrm[2]]);
    if (!hits.length) continue;
    const d = hits[0];
    min = Math.min(min, d);
    if (d < limit) thin++;
  }
  return { minThickness: Number.isFinite(min) ? min : 0, thinPct: (thin / samples) * 100 };
}

export function analyzePrintability(part: Manifold, tech: Technology, down: Vec3 = [0, 0, -1]): PrintabilityReport {
  const mesh = manifoldToMeshData(part);
  const fd = faceData(mesh);
  const limit = THIN[tech];
  return { ...orientationMetrics(mesh, fd, down), ...thickness(mesh, fd, limit), thinLimit: limit };
}

/**
 * Picks the side to put on the plate: axis directions plus the cut-face normals
 * (a flat cut face down is usually best). Score = overhang area − 1.5 × base area.
 */
export function suggestOrientation(part: Manifold, tech: Technology, faceNormals: { normal: Vec3; label: string }[]): OrientationSuggestion {
  const mesh = manifoldToMeshData(part);
  const fd = faceData(mesh);
  const thick = thickness(mesh, fd, THIN[tech]);
  const candidates: { down: Vec3; label: string }[] = [
    ...faceNormals.map((f) => ({ down: f.normal, label: `face ${f.label} para baixo` })),
    { down: [0, 0, -1], label: 'como está' },
    { down: [0, 0, 1], label: 'de cabeça para baixo' },
    { down: [1, 0, 0], label: 'deitada (+X para baixo)' },
    { down: [-1, 0, 0], label: 'deitada (−X para baixo)' },
    { down: [0, 1, 0], label: 'deitada (+Y para baixo)' },
    { down: [0, -1, 0], label: 'deitada (−Y para baixo)' },
  ];
  let best = candidates[0], bestScore = Infinity, bestM = orientationMetrics(mesh, fd, candidates[0].down);
  for (const c of candidates) {
    const m = orientationMetrics(mesh, fd, c.down);
    const score = m.overhangArea - 1.5 * m.baseArea;
    if (score < bestScore - 1e-6) { bestScore = score; best = c; bestM = m; }
  }
  const current = { ...orientationMetrics(mesh, fd, [0, 0, -1]), ...thick, thinLimit: THIN[tech] };
  return { down: best.down, label: best.label, report: { ...bestM, ...thick, thinLimit: THIN[tech] }, current };
}
