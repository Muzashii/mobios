import type { Manifold } from 'manifold-3d';
import { MeshQuery } from '../mesh/bvh';
import { buildCap } from '../regionCut';
import { cleanTriangles, orientConsistently, tryManifold, weldVertices } from '../repair';
import { fitPlane } from '../segment/region';
import type { MeshData, RepairPlan, Vec3 } from '../types';
import type { Wasm } from '../wasm';
import { debrisThreshold, meshFacts, shellContainment } from './index';
import { volumetricRemesh } from './volumetric';

/**
 * Repair driven by the user's choices in the Raio-X panel. Every step reports what it changed
 * in plain Portuguese; nothing happens that the report does not name.
 */
export interface PlanResult {
  manifolds: Manifold[];
  notes: string[];
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

/** The recommended plan: first option of every issue. */
export function defaultPlan(issues: { kind: keyof RepairPlan; options: { value: string }[] }[]): RepairPlan {
  const plan: RepairPlan = {};
  for (const i of issues) if (i.options.length) (plan as Record<string, string>)[i.kind] = i.options[0].value;
  return plan;
}

export function repairWithPlan(wasm: Wasm, positions: Float32Array, indices: Uint32Array | undefined, plan: RepairPlan): PlanResult {
  const notes: string[] = [];
  let mesh = weldVertices(positions, indices);

  const scale = Number(plan.scale ?? '1');
  if (scale !== 1 && Number.isFinite(scale) && scale > 0) {
    const s = Float32Array.from(mesh.positions, (v) => v * scale);
    mesh = { positions: s, indices: mesh.indices };
    notes.push(`escala ×${scale.toLocaleString('pt-BR')}`);
  }

  const volumetric = plan['non-manifold'] === 'volumetric' || plan['self-intersections'] === 'volumetric' || plan.needles === 'volumetric';
  let solid: Manifold | null = null;
  if (!volumetric) {
    const tris = cleanTriangles(mesh, notes);
    let work: MeshData = { positions: mesh.positions, indices: tris };
    work = removeExcessFaces(work, notes);
    work = splitPinchedVertices(work, notes);
    if (plan.orientation !== 'keep') orientConsistently(work.indices, notes);
    work = fillHoles(work, plan.holes === 'flat' ? 'flat' : 'smooth', notes);
    work = fixShellOrientation(work, plan['inner-shells'] === 'remove', plan.orientation !== 'keep', notes);
    solid = tryManifold(wasm, work);
    if (!solid) {
      // Near-coincident seams: weld more aggressively and try again.
      const rewelded = weldVertices(work.positions, work.indices, 1e-3);
      const t2 = cleanTriangles(rewelded, []);
      orientConsistently(t2, []);
      solid = tryManifold(wasm, fillHoles({ positions: rewelded.positions, indices: t2 }, 'smooth', []));
      if (solid) notes.push('costuras quase coincidentes unidas (0,001 mm)');
    }
    if (solid && solid.volume() < 0) {
      solid.delete();
      solid = null;
    }
    if (!solid) notes.push('o reparo sem perda não fechou a malha — ela foi reconstruída (remesh volumétrico)');
  }
  if (!solid) {
    // Chosen by the user: their resolution. Forced fallback: finer, to keep as much as possible.
    const res = Math.round(Math.min(400, Math.max(32, plan.volumetricResolution ?? (volumetric ? 160 : 240))));
    const { manifold, voxel } = volumetricRemesh(wasm, mesh, res);
    solid = manifold;
    notes.push(`remesh volumétrico (${res} voxels; detalhe mínimo ≈ ${voxel.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mm)`);
  }

  // Shells: union / separate / keep, debris and voids.
  const mode = plan.shells ?? 'union';
  const comps = solid.decompose();
  let manifolds: Manifold[];
  if (comps.length > 1 && mode !== 'keep') {
    const total = comps.reduce((s, c) => s + c.volume(), 0);
    const debris = debrisThreshold(total);
    const positives = comps.filter((c) => c.volume() > 0);
    const voids = comps.filter((c) => c.volume() < 0);
    let kept = positives.filter((c) => c.volume() >= debris);
    if (!kept.length) kept = positives.length ? [positives.reduce((x, y) => (y.volume() > x.volume() ? y : x))] : comps.slice(0, 1);
    const dropped = positives.length - kept.length;
    if (dropped) notes.push(`${fmt(dropped)} sujeira(s) flutuante(s) removida(s)`);
    if (mode === 'separate') {
      manifolds = kept.map((c) => {
        const inner = voids.filter((v) => inside(c, v));
        return inner.length ? wasm.Manifold.compose([c, ...inner]) : c.translate([0, 0, 0]);
      });
      if (manifolds.length > 1) notes.push(`${manifolds.length} corpos importados como partes separadas`);
    } else if (kept.length === 1 && !dropped) {
      // One body (plus voids): nothing to merge — keep the solid as built (compose drops voids).
      manifolds = [solid.translate([0, 0, 0])];
    } else {
      const merged = kept.length > 1 ? wasm.Manifold.union(kept) : kept[0].translate([0, 0, 0]);
      const after = merged.decompose();
      if (kept.length > 1 && after.length < kept.length) notes.push(`${kept.length} cascas unidas em ${after.length === 1 ? 'um sólido' : `${after.length} sólidos`}`);
      after.forEach((m) => m.delete());
      manifolds = [voids.length ? wasm.Manifold.compose([merged, ...voids]) : merged];
      if (voids.length) merged.delete();
    }
    solid.delete();
  } else {
    manifolds = [solid];
  }
  comps.forEach((c) => c.delete());

  // Decimation of huge meshes.
  const target = Number(plan.huge ?? '0');
  if (target > 0) {
    manifolds = manifolds.map((m) => {
      const before = m.numTri();
      if (before <= target) return m;
      const box = m.boundingBox();
      const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
      let out = m, tol = diag * 2e-5;
      while (out.numTri() > target && tol < diag * 0.02) {
        const next = m.simplify(tol);
        if (out !== m) out.delete();
        out = next;
        tol *= 1.6;
      }
      notes.push(`decimado de ${fmt(before)} para ${fmt(out.numTri())} triângulos (desvio máx. ${(tol / 1.6).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} mm)`);
      if (out !== m) m.delete();
      return out;
    });
  }
  return { manifolds, notes };
}

/** Is `inner` (a void) inside `outer`? Bounding-box containment is enough for voids. */
function inside(outer: Manifold, inner: Manifold) {
  const a = outer.boundingBox(), b = inner.boundingBox();
  return [0, 1, 2].every((k) => b.min[k] >= a.min[k] && b.max[k] <= a.max[k]);
}

/** Edges shared by more than two faces: drop the smallest extra faces (fins, duplicates). */
function removeExcessFaces(mesh: MeshData, notes: string[]): MeshData {
  const { positions: p, indices: t } = mesh;
  const nv = p.length / 3;
  const edgeFaces = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let f = 0; f < t.length / 3; f++) for (let k = 0; k < 3; k++) {
    const kk = key(t[f * 3 + k], t[f * 3 + (k + 1) % 3]);
    const list = edgeFaces.get(kk);
    if (list) list.push(f); else edgeFaces.set(kk, [f]);
  }
  const area = (f: number) => {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  };
  // Dangling faces (fins: their other edges are open) go first, then the smallest.
  const openEdges = (f: number) => {
    let n = 0;
    for (let k = 0; k < 3; k++) if ((edgeFaces.get(key(t[f * 3 + k], t[f * 3 + (k + 1) % 3]))?.length ?? 0) === 1) n++;
    return n;
  };
  const drop = new Set<number>();
  for (const faces of edgeFaces.values()) {
    const alive = faces.filter((f) => !drop.has(f));
    if (alive.length <= 2) continue;
    alive.sort((x, y) => openEdges(x) - openEdges(y) || area(y) - area(x));
    for (const f of alive.slice(2)) drop.add(f);
  }
  if (!drop.size) return mesh;
  notes.push(`${fmt(drop.size)} face(s) excedente(s) em arestas não-manifold removida(s)`);
  const keep: number[] = [];
  for (let f = 0; f < t.length / 3; f++) if (!drop.has(f)) keep.push(t[f * 3], t[f * 3 + 1], t[f * 3 + 2]);
  return { positions: p, indices: Uint32Array.from(keep) };
}

/** A vertex where two surfaces touch at a point gets one copy per fan. */
function splitPinchedVertices(mesh: MeshData, notes: string[]): MeshData {
  const facts = meshFacts(mesh.positions, mesh.indices);
  const pinched = new Set(facts.nonManifoldVertices);
  if (!pinched.size) return mesh;
  const { positions: p } = facts.mesh;
  const t = Uint32Array.from(facts.mesh.indices);
  const extra: number[] = [];
  let next = p.length / 3;
  for (const v of pinched) {
    const faces: number[] = [];
    for (let f = 0; f < t.length / 3; f++) if (t[f * 3] === v || t[f * 3 + 1] === v || t[f * 3 + 2] === v) faces.push(f);
    const parent = faces.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      for (let k = 0; k < 3; k++) {
        const x = t[faces[i] * 3 + k];
        if (x !== v && (t[faces[j] * 3] === x || t[faces[j] * 3 + 1] === x || t[faces[j] * 3 + 2] === x)) parent[find(i)] = find(j);
      }
    }
    const fans = new Map<number, number[]>();
    faces.forEach((f, i) => {
      const r = find(i);
      const list = fans.get(r);
      if (list) list.push(f); else fans.set(r, [f]);
    });
    let first = true;
    for (const list of fans.values()) {
      if (first) { first = false; continue; }
      extra.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      for (const f of list) for (let k = 0; k < 3; k++) if (t[f * 3 + k] === v) t[f * 3 + k] = next;
      next++;
    }
  }
  notes.push(`${fmt(pinched.size)} vértice(s) não-manifold dividido(s)`);
  const pos = new Float32Array(p.length + extra.length);
  pos.set(p);
  pos.set(extra, p.length);
  return { positions: pos, indices: t };
}

/** Boundary loops (each runs opposite to its faces' winding, i.e. the way a cap must go). */
function holeLoops(t: Uint32Array): number[][] {
  const directed = new Set<string>();
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) directed.add(`${t[i + k]},${t[i + (k + 1) % 3]}`);
  const next = new Map<number, number>();
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = t[i + k], b = t[i + (k + 1) % 3];
    if (!directed.has(`${b},${a}`)) next.set(b, a);
  }
  const loops: number[][] = [];
  const guard = next.size + 1;
  while (next.size) {
    const start = next.keys().next().value as number;
    const loop: number[] = [];
    let cur = start;
    while (next.has(cur) && loop.length <= guard) {
      loop.push(cur);
      const nx = next.get(cur)!;
      next.delete(cur);
      cur = nx;
      if (cur === start) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Fills holes. flat: ear clipping in the loop's best-fit plane. smooth: concentric rings
 * relaxed with Laplacian fairing (a membrane that continues the surface around the hole).
 */
export function fillHoles(mesh: MeshData, mode: 'flat' | 'smooth', notes: string[]): MeshData {
  const loops = holeLoops(mesh.indices);
  if (!loops.length) return mesh;
  const pos: number[] = Array.from(mesh.positions);
  const tris: number[] = Array.from(mesh.indices);
  const p = mesh.positions;
  for (const loop of loops) {
    if (loop.length === 3) {
      tris.push(loop[0], loop[1], loop[2]);
      continue;
    }
    const pts = loop.map((v): Vec3 => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
    let edge = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      edge += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    edge /= pts.length;
    const c: Vec3 = [0, 0, 0];
    for (const q of pts) for (let k = 0; k < 3; k++) c[k] += q[k] / pts.length;
    const { plane } = fitPlane(pts, c);
    const firstNew = pos.length / 3;
    try {
      if (mode === 'flat') {
        const cap = buildCap([...loop].reverse(), plane, pos, edge * 1e6, false); // huge edge → no rings: ear clip / single fan
        tris.push(...cap.tris);
      } else {
        const cap = buildCap([...loop].reverse(), plane, pos, edge, false);
        tris.push(...cap.tris);
        fair(pos, cap.tris, firstNew);
      }
    } catch {
      // Self-crossing outline: fall back to a fan around the centroid.
      pos.push(c[0], c[1], c[2]);
      const centre = pos.length / 3 - 1;
      for (let i = 0; i < loop.length; i++) tris.push(loop[i], loop[(i + 1) % loop.length], centre);
    }
  }
  notes.push(`${fmt(loops.length)} furo(s) fechado(s) (${mode === 'flat' ? 'plano' : 'suave'})`);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tris) };
}

/** Laplacian relaxation of the new vertices (index ≥ firstNew) over the cap triangles. */
function fair(pos: number[], tris: number[], firstNew: number) {
  const n = pos.length / 3 - firstNew;
  if (n <= 0) return;
  const nbrs: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = tris[i + k], b = tris[i + (k + 1) % 3];
    if (a >= firstNew) nbrs[a - firstNew].add(b);
    if (b >= firstNew) nbrs[b - firstNew].add(a);
  }
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < n; i++) {
      const v = firstNew + i;
      let x = 0, y = 0, z = 0;
      for (const w of nbrs[i]) { x += pos[w * 3]; y += pos[w * 3 + 1]; z += pos[w * 3 + 2]; }
      const k = nbrs[i].size || 1;
      pos[v * 3] = 0.5 * pos[v * 3] + 0.5 * (x / k);
      pos[v * 3 + 1] = 0.5 * pos[v * 3 + 1] + 0.5 * (y / k);
      pos[v * 3 + 2] = 0.5 * pos[v * 3 + 2] + 0.5 * (z / k);
    }
  }
}

/**
 * After a consistent winding, whole shells can still be inside out. Shells with negative
 * volume that sit inside another shell are voids (kept, or dropped with `removeVoids`);
 * the rest are flipped.
 */
function fixShellOrientation(mesh: MeshData, removeVoids: boolean, flip: boolean, notes: string[]): MeshData {
  const facts = meshFacts(mesh.positions, mesh.indices);
  if (!facts.shells.some((s) => s.volume < 0)) return facts.mesh;
  const query = new MeshQuery(facts.mesh);
  shellContainment(facts, query);
  query.dispose();
  const t = Uint32Array.from(facts.mesh.indices);
  const keep: number[] = [];
  let flipped = 0, removed = 0;
  const flipShell = new Set(facts.shells.filter((s) => s.volume < 0 && s.container < 0).map((s) => s.id));
  const voidShell = new Set(facts.shells.filter((s) => s.volume < 0 && s.container >= 0).map((s) => s.id));
  for (let f = 0; f < t.length / 3; f++) {
    const s = facts.shellOf[f];
    if (removeVoids && voidShell.has(s)) continue;
    if (flip && flipShell.has(s)) keep.push(t[f * 3], t[f * 3 + 2], t[f * 3 + 1]);
    else keep.push(t[f * 3], t[f * 3 + 1], t[f * 3 + 2]);
  }
  flipped = flip ? flipShell.size : 0;
  removed = removeVoids ? voidShell.size : 0;
  if (flipped) notes.push(`${fmt(flipped)} casca(s) virada(s) do avesso corrigida(s)`);
  if (removed) notes.push(`${fmt(removed)} vazio(s) interno(s) removido(s)`);
  return { positions: facts.mesh.positions, indices: Uint32Array.from(keep) };
}
