import type { Manifold } from 'manifold-3d';
import type { MeshData } from './types';
import type { Wasm } from './wasm';

export interface RepairResult {
  manifold: Manifold;
  report: string[];
}

/** Welds identical (quantized) vertices of a triangle soup or indexed mesh. */
export function weldVertices(positions: Float32Array, indices?: Uint32Array, tolerance?: number): MeshData {
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  const cornerCount = triCount * 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const eps = tolerance ?? Math.max(diag * 1e-7, 1e-6);
  const inv = 1 / eps;

  let size = 1;
  while (size < cornerCount * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const qx = new Int32Array(cornerCount), qy = new Int32Array(cornerCount), qz = new Int32Array(cornerCount);
  const out = new Float32Array(cornerCount * 3);
  const outIdx = new Uint32Array(cornerCount);
  let count = 0;

  for (let c = 0; c < cornerCount; c++) {
    const src = indices ? indices[c] : c;
    const x = positions[src * 3], y = positions[src * 3 + 1], z = positions[src * 3 + 2];
    const ix = Math.round((x - minX) * inv), iy = Math.round((y - minY) * inv), iz = Math.round((z - minZ) * inv);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    for (;;) {
      const slot = table[h];
      if (slot === -1) {
        table[h] = count;
        qx[count] = ix; qy[count] = iy; qz[count] = iz;
        out[count * 3] = x; out[count * 3 + 1] = y; out[count * 3 + 2] = z;
        outIdx[c] = count++;
        break;
      }
      if (qx[slot] === ix && qy[slot] === iy && qz[slot] === iz) {
        outIdx[c] = slot;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return { positions: out.slice(0, count * 3), indices: outIdx };
}

const edgeKey = (a: number, b: number) => (a < b ? a * 0x100000000 + b : b * 0x100000000 + a);

/** Removes degenerate and duplicate triangles. */
function cleanTriangles(mesh: MeshData, report: string[]): Uint32Array {
  const { positions: p, indices } = mesh;
  const keep: number[] = [];
  const seen = new Set<string>();
  let degenerate = 0, duplicate = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    const abx = p[b * 3] - p[a * 3], aby = p[b * 3 + 1] - p[a * 3 + 1], abz = p[b * 3 + 2] - p[a * 3 + 2];
    const acx = p[c * 3] - p[a * 3], acy = p[c * 3 + 1] - p[a * 3 + 1], acz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    if (cx * cx + cy * cy + cz * cz < 1e-24) { degenerate++; continue; }
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) { duplicate++; continue; }
    seen.add(s);
    keep.push(a, b, c);
  }
  if (degenerate) report.push(`${degenerate} face(s) degenerada(s) removida(s)`);
  if (duplicate) report.push(`${duplicate} face(s) duplicada(s) removida(s)`);
  return Uint32Array.from(keep);
}

/** Makes triangle winding consistent across shared edges (BFS per component). */
function orientConsistently(tris: Uint32Array, report: string[]) {
  const n = tris.length / 3;
  const edgeFaces = new Map<number, number[]>();
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tris[f * 3 + k], tris[f * 3 + ((k + 1) % 3)]);
      const list = edgeFaces.get(key);
      if (list) list.push(f); else edgeFaces.set(key, [f]);
    }
  }
  const visited = new Uint8Array(n);
  let flipped = 0;
  const hasDirected = (f: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (tris[f * 3 + k] === a && tris[f * 3 + ((k + 1) % 3)] === b) return true;
    return false;
  };
  for (let seed = 0; seed < n; seed++) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const queue = [seed];
    while (queue.length) {
      const f = queue.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = tris[f * 3 + k], b = tris[f * 3 + ((k + 1) % 3)];
        const faces = edgeFaces.get(edgeKey(a, b))!;
        if (faces.length !== 2) continue;
        const g = faces[0] === f ? faces[1] : faces[0];
        if (visited[g]) continue;
        visited[g] = 1;
        // A consistent neighbour traverses the shared edge as b -> a.
        if (hasDirected(g, a, b)) {
          const t = tris[g * 3 + 1];
          tris[g * 3 + 1] = tris[g * 3 + 2];
          tris[g * 3 + 2] = t;
          flipped++;
        }
        queue.push(g);
      }
    }
  }
  if (flipped) report.push(`${flipped} normal(is) invertida(s) corrigida(s)`);
  let nonManifold = 0;
  for (const faces of edgeFaces.values()) if (faces.length > 2) nonManifold++;
  return nonManifold;
}

/** Fills boundary loops with a fan around their centroid. */
function fillHoles(positions: Float32Array, tris: Uint32Array, report: string[]): MeshData {
  const directed = new Map<number, number>(); // count of directed edge a->b keyed by pair
  const key = (a: number, b: number) => a * 0x100000000 + b;
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) directed.set(key(tris[t + k], tris[t + ((k + 1) % 3)]), 1);
  }
  // Boundary half-edge: a->b present but b->a missing. The hole loop runs b->a.
  const next = new Map<number, number>();
  for (const k of directed.keys()) {
    const a = Math.floor(k / 0x100000000), b = k % 0x100000000;
    if (!directed.has(key(b, a))) next.set(b, a);
  }
  if (next.size === 0) return { positions, indices: tris };

  const extraPos: number[] = [];
  const extraTris: number[] = [];
  let vertCount = positions.length / 3;
  let holes = 0;
  while (next.size) {
    const start = next.keys().next().value as number;
    const loop: number[] = [];
    let cur = start;
    while (next.has(cur) && loop.length <= next.size + 1) {
      loop.push(cur);
      const nx = next.get(cur)!;
      next.delete(cur);
      cur = nx;
      if (cur === start) break;
    }
    if (loop.length < 3) continue;
    holes++;
    if (loop.length === 3) {
      extraTris.push(loop[0], loop[1], loop[2]);
      continue;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) { cx += positions[v * 3]; cy += positions[v * 3 + 1]; cz += positions[v * 3 + 2]; }
    extraPos.push(cx / loop.length, cy / loop.length, cz / loop.length);
    const center = vertCount++;
    for (let i = 0; i < loop.length; i++) extraTris.push(loop[i], loop[(i + 1) % loop.length], center);
  }
  if (holes) report.push(`${holes} buraco(s) fechado(s)`);
  const p = new Float32Array(positions.length + extraPos.length);
  p.set(positions);
  p.set(extraPos, positions.length);
  const t = new Uint32Array(tris.length + extraTris.length);
  t.set(tris);
  t.set(extraTris, tris.length);
  return { positions: p, indices: t };
}

function signedVolume(p: Float32Array, t: Uint32Array) {
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

function tryManifold(wasm: Wasm, mesh: MeshData): Manifold | null {
  const m = new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
  m.merge();
  try {
    const result = new wasm.Manifold(m);
    if (result.status() === 'NoError' && !result.isEmpty()) return result;
    result.delete();
  } catch {
    // Not manifold; caller continues repairing.
  }
  return null;
}

/**
 * Turns any triangle soup into a valid closed manifold, reporting what was fixed (pt-BR).
 * Throws when the mesh is beyond repair.
 */
export function repairMesh(wasm: Wasm, positions: Float32Array, indices?: Uint32Array): RepairResult {
  const report: string[] = [];
  const welded = weldVertices(positions, indices);
  const direct = tryManifold(wasm, welded);
  if (direct) {
    if (direct.volume() >= 0) return { manifold: finalize(wasm, direct, report), report };
    direct.delete();
  }

  const tris = cleanTriangles(welded, report);
  const nonManifold = orientConsistently(tris, report);
  let mesh = fillHoles(welded.positions, tris, report);
  if (signedVolume(mesh.positions, mesh.indices) < 0) {
    const t = mesh.indices;
    for (let i = 0; i < t.length; i += 3) { const x = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = x; }
    report.push('orientação geral invertida corrigida');
  }
  let result = tryManifold(wasm, mesh);
  if (!result && nonManifold > 0) {
    // Weld more aggressively: resolves most near-coincident seams.
    mesh = weldVertices(mesh.positions, mesh.indices, 1e-3);
    const t2 = cleanTriangles(mesh, []);
    orientConsistently(t2, []);
    result = tryManifold(wasm, fillHoles(mesh.positions, t2, []));
    if (result) report.push('costuras quase coincidentes unidas (tolerância 0,001 mm)');
  }
  if (!result) {
    throw new Error(
      nonManifold > 0
        ? `A malha tem ${nonManifold} aresta(s) não-manifold e não pôde ser reparada automaticamente.`
        : 'A malha não pôde ser reparada automaticamente.',
    );
  }
  return { manifold: finalize(wasm, result, report), report };
}

/** Merges overlapping shells (common in downloaded figures) into one solid. */
function finalize(wasm: Wasm, m: Manifold, report: string[]): Manifold {
  const parts = m.decompose();
  if (parts.length > 1 && parts.every((p) => p.volume() > 0)) {
    const sum = parts.reduce((s, p) => s + p.volume(), 0);
    const merged = wasm.Manifold.union(parts);
    if (merged.volume() < sum * 0.9999) {
      report.push(`${parts.length} cascas sobrepostas unidas em um sólido`);
      parts.forEach((p) => p.delete());
      m.delete();
      return merged;
    }
    merged.delete();
  }
  parts.forEach((p) => p.delete());
  return m;
}

export function manifoldToMeshData(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  let positions: Float32Array;
  if (np === 3) {
    positions = mesh.vertProperties.slice();
  } else {
    const n = mesh.vertProperties.length / np;
    positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = mesh.vertProperties[i * np];
      positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
    }
  }
  return { positions, indices: mesh.triVerts.slice() };
}

export function meshDataToManifold(wasm: Wasm, data: MeshData): Manifold {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: data.positions, triVerts: data.indices });
  mesh.merge();
  return new wasm.Manifold(mesh);
}
