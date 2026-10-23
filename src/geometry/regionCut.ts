import { Box3, Vector3 } from 'three';
import type { Manifold } from 'manifold-3d';
import { CutError, cutByPlane } from './cut';
import { planeFrame } from './math';
import { trianglesIntersect } from './mesh/tritri';
import { meshDataToManifold } from './repair';
import { boundaryLoops, fitPlane, labelFaces, LoopError, regionField, type RegionContext } from './segment/region';
import type { MeshData, Plane, RegionCutOperation, Vec3 } from './types';
import type { Wasm } from './wasm';

/**
 * Region cut (SmartCut v2): the part is split along the boundary of a face region instead of a
 * plane. Each half keeps its own surface exactly and gets a cap across the boundary loop:
 *
 * - surface: the cap is a height field over the ring's plane, flat in the middle (pins and the
 *   joint number go there) and blending smoothly up to the ring, which may be any 3D curve.
 * - shell: the region leaves as a shell `depth` mm thick (hair, helmet, cloak); the body keeps
 *   a matching recess that self-aligns the piece.
 *
 * Both halves are built as meshes (no booleans) and validated: manifold, positive volumes that
 * add up, cap not piercing the surface. Anything else falls back to a plane cut whose island is
 * picked by the seeds.
 */
export interface RegionSplit {
  a: MeshData;
  b: MeshData;
  plane: Plane;
  /** Radius of the flat disc in the middle of the main cap (0 = none). */
  faceRadius: number;
  loops: Vec3[][];
}

const at = (p: ArrayLike<number>, i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];

/** Splits the analysis mesh by face labels (1 = B). */
export function splitRegion(ctx: RegionContext, labels: Uint8Array, opts: { mode: 'surface' | 'shell'; depth?: number; towards: Vec3 }): RegionSplit {
  const { topo } = ctx;
  const loopsIdx = boundaryLoops(topo, labels);
  if (!loopsIdx.length) throw new LoopError('A região não tem contorno: ela já é uma peça separada.');
  const pos: number[] = Array.from(topo.p);
  const aTris: number[] = [];
  const bTris: number[] = [];
  for (let f = 0; f < topo.nf; f++) (labels[f] ? bTris : aTris).push(topo.t[f * 3], topo.t[f * 3 + 1], topo.t[f * 3 + 2]);

  const loops = loopsIdx.map((l) => l.map((v) => at(topo.p, v)));
  const main = loops.reduce((x, y) => (y.length > x.length ? y : x));
  const fit = fitPlane(main, opts.towards);
  let faceRadius = 0;
  let origin = fit.plane.origin;

  if (opts.mode === 'shell') {
    buildShell(ctx, labels, loopsIdx, pos, aTris, bTris, opts.depth ?? 3);
  } else {
    for (let i = 0; i < loopsIdx.length; i++) {
      const isMain = loops[i] === main;
      const plane = isMain ? fit.plane : fitPlane(loops[i], opts.towards).plane;
      const cap = buildCap(loopsIdx[i], plane, pos, ctx.edge, isMain);
      if (isMain) {
        faceRadius = cap.flatRadius;
        origin = cap.centre;
      }
      bTris.push(...cap.tris);
      for (let k = 0; k < cap.tris.length; k += 3) aTris.push(cap.tris[k], cap.tris[k + 2], cap.tris[k + 1]);
      if (capPierces(ctx, pos, cap.tris)) throw new LoopError('A tampa curva atravessa a superfície da peça.');
    }
  }
  const P = Float32Array.from(pos);
  // Pins and numbering are centred on the flat disc of the cap.
  return { a: compact(P, aTris), b: compact(P, bTris), plane: { origin, normal: fit.plane.normal }, faceRadius, loops };
}

/** Keeps only the vertices a triangle list uses. */
function compact(p: Float32Array, tris: number[]): MeshData {
  const map = new Int32Array(p.length / 3).fill(-1);
  const out: number[] = [];
  const idx = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    if (map[v] < 0) {
      map[v] = out.length / 3;
      out.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
    }
    idx[i] = map[v];
  }
  return { positions: Float32Array.from(out), indices: idx };
}

const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Cap across one boundary loop (triangles oriented for B). Star-shaped loops get concentric
 * rings with a flat centre; others an ear-clipped polygon.
 */
export function buildCap(loop: number[], plane: Plane, pos: number[], edge: number, flatCentre: boolean): { tris: number[]; flatRadius: number; centre: Vec3 } {
  const { u, v, n, origin } = planeFrame(plane);
  const N = loop.length;
  const local = loop.map((i) => {
    const d = [pos[i * 3] - origin[0], pos[i * 3 + 1] - origin[1], pos[i * 3 + 2] - origin[2]];
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * n[0] + d[1] * n[1] + d[2] * n[2]];
  });
  // Smoothed 2D outline for the inner rings (the exact loop zigzags along triangle edges).
  let q = local.map(([x, y]) => [x, y]);
  for (let it = 0; it < 4; it++) q = q.map((c, i) => {
    const a = q[(i + N - 1) % N], b = q[(i + 1) % N];
    return [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
  });
  // Area centroid of the smoothed polygon.
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < N; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % N];
    const cr = x0 * y1 - x1 * y0;
    area += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) throw new LoopError('Contorno degenerado.');
  cx /= 6 * area; cy /= 6 * area;
  const sign = Math.sign(area);
  let star = true;
  for (let i = 0; i < N && star; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % N];
    if (((x0 - cx) * (y1 - cy) - (x1 - cx) * (y0 - cy)) * sign <= 0) star = false;
  }
  const toWorld = (x: number, y: number, z: number) => {
    pos.push(origin[0] + u[0] * x + v[0] * y + n[0] * z, origin[1] + u[1] * x + v[1] * y + n[1] * z, origin[2] + u[2] * x + v[2] * y + n[2] * z);
    return pos.length / 3 - 1;
  };

  if (!star) {
    const tris = earClip(local.map(([x, y]) => [x, y] as [number, number]));
    if (!tris) throw new LoopError('O contorno projetado se cruza; não dá para fechar com uma tampa.');
    // Ear clipping keeps the loop's winding; B needs the loop edges reversed.
    const out: number[] = [];
    for (let k = 0; k < tris.length; k += 3) out.push(loop[tris[k]], loop[tris[k + 2]], loop[tris[k + 1]]);
    return { tris: out, flatRadius: 0, centre: origin };
  }

  // Inradius of the smoothed outline around the centre.
  let rho = Infinity;
  for (let i = 0; i < N; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % N];
    const dx = x1 - x0, dy = y1 - y0;
    const tt = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / (dx * dx + dy * dy || 1)));
    rho = Math.min(rho, Math.hypot(x0 + dx * tt - cx, y0 + dy * tt - cy));
  }
  const K = Math.max(flatCentre ? 4 : 2, Math.min(20, Math.ceil(rho / (1.5 * edge))));
  // Flat centre at mid height of the ring, as wide as its height allows: the blend up/down to
  // the ring stays below ~60°, so even a saddle-shaped shoulder ring leaves room for a pin.
  let zLo = Infinity, zHi = -Infinity;
  for (const l of local) { zLo = Math.min(zLo, l[2]); zHi = Math.max(zHi, l[2]); }
  const zc = flatCentre ? (zLo + zHi) / 2 : 0;
  const dev = (zHi - zLo) / 2;
  const s0 = flatCentre && K >= 4 ? Math.max(0.4, Math.min(0.85, 1 - (dev * 0.6) / Math.max(rho, 1e-9))) : 0;
  const rings: number[][] = [];
  for (let k = 1; k < K; k++) {
    const s = k / K;
    const w = s0 > 0 ? smoothstep((s - s0) / (1 - s0)) : s;
    rings.push(q.map(([x, y], i) => toWorld(cx + (x - cx) * s, cy + (y - cy) * s, zc + (local[i][2] - zc) * w)));
  }
  rings.push(loop);
  const centre = toWorld(cx, cy, zc);
  const centrePoint: Vec3 = [pos[centre * 3], pos[centre * 3 + 1], pos[centre * 3 + 2]];
  const tris: number[] = [];
  const inner = rings[0];
  for (let i = 0; i < N; i++) tris.push(inner[(i + 1) % N], inner[i], centre);
  for (let k = 1; k < rings.length; k++) {
    const R = rings[k - 1], L = rings[k];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      tris.push(L[j], L[i], R[i], L[j], R[i], R[j]);
    }
  }
  return { tris, flatRadius: s0 * rho * 0.95, centre: centrePoint };
}

/** Ear clipping of a simple polygon (indices into `pts`, same winding as the input). */
export function earClip(pts: [number, number][]): number[] | null {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const sign = Math.sign(area) || 1;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const cross = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p: number, a: number, b: number, c: number) => cross(a, b, p) * sign >= 0 && cross(b, c, p) * sign >= 0 && cross(c, a, p) * sign >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) * sign <= 0) continue;
      let ear = true;
      for (const p of idx) if (p !== a && p !== b && p !== c && inside(p, a, b, c)) { ear = false; break; }
      if (!ear) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/**
 * Shell: B's surface offset inwards by `depth` (smoothed normals) closes the region from
 * inside; a wall joins the loop to its offset copy.
 */
function buildShell(ctx: RegionContext, labels: Uint8Array, loops: number[][], pos: number[], aTris: number[], bTris: number[], depth: number) {
  const { topo } = ctx;
  const { nv, nf, t, vStart, vNbr } = topo;
  const used = new Uint8Array(nv);
  for (let f = 0; f < nf; f++) if (labels[f]) for (let k = 0; k < 3; k++) used[t[f * 3 + k]] = 1;
  // Smoothed vertex normals over the region (thin features would fold otherwise).
  let nrm = Float32Array.from(topo.vNormal);
  for (let it = 0; it < 3; it++) {
    const next = new Float32Array(nrm.length);
    for (let vtx = 0; vtx < nv; vtx++) {
      if (!used[vtx]) continue;
      let x = nrm[vtx * 3], y = nrm[vtx * 3 + 1], z = nrm[vtx * 3 + 2];
      for (let k = vStart[vtx]; k < vStart[vtx + 1]; k++) {
        const w = vNbr[k];
        x += nrm[w * 3]; y += nrm[w * 3 + 1]; z += nrm[w * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      next[vtx * 3] = x / l; next[vtx * 3 + 1] = y / l; next[vtx * 3 + 2] = z / l;
    }
    nrm = next;
  }
  const off = new Int32Array(nv).fill(-1);
  for (let vtx = 0; vtx < nv; vtx++) {
    if (!used[vtx]) continue;
    off[vtx] = pos.length / 3;
    pos.push(topo.p[vtx * 3] - nrm[vtx * 3] * depth, topo.p[vtx * 3 + 1] - nrm[vtx * 3 + 1] * depth, topo.p[vtx * 3 + 2] - nrm[vtx * 3 + 2] * depth);
  }
  const inner: number[] = [];
  for (let f = 0; f < nf; f++) {
    if (!labels[f]) continue;
    const a = off[t[f * 3]], b = off[t[f * 3 + 1]], c = off[t[f * 3 + 2]];
    bTris.push(a, c, b); // facing into the body
    inner.push(a, b, c);
  }
  aTris.push(...inner);
  for (const L of loops) {
    for (let i = 0; i < L.length; i++) {
      const j = (i + 1) % L.length;
      const li = L[i], lj = L[j], oi = off[li], oj = off[lj];
      bTris.push(lj, li, oi, lj, oi, oj);
      aTris.push(lj, oi, li, lj, oj, oi);
    }
  }
  if (capPierces(ctx, pos, inner)) throw new CutError('A casca dobra sobre si mesma nesta profundidade.', 'smaller-depth');
}

/** Does any cap triangle cross the original surface? (BVH culling + exact tri–tri test.) */
function capPierces(ctx: RegionContext, pos: number[], tris: number[]): boolean {
  const bvh = ctx.query.bvh;
  const T = new Float64Array(9);
  const box = new Box3();
  const lo = new Vector3(), hi = new Vector3();
  const S = new Float64Array(9);
  for (let k = 0; k < tris.length; k += 3) {
    for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) T[j * 3 + c] = pos[tris[k + j] * 3 + c];
    lo.set(Math.min(T[0], T[3], T[6]), Math.min(T[1], T[4], T[7]), Math.min(T[2], T[5], T[8]));
    hi.set(Math.max(T[0], T[3], T[6]), Math.max(T[1], T[4], T[7]), Math.max(T[2], T[5], T[8]));
    box.set(lo, hi);
    let hit = false;
    bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const vs = [tri.a, tri.b, tri.c];
        // Shared loop vertices touch by construction: skip triangles that share one.
        for (const p of vs) for (let j = 0; j < 3; j++) if (p.x === T[j * 3] && p.y === T[j * 3 + 1] && p.z === T[j * 3 + 2]) return false;
        vs.forEach((p, j) => { S[j * 3] = p.x; S[j * 3 + 1] = p.y; S[j * 3 + 2] = p.z; });
        if (trianglesIntersect(T, S, ctx.diag * 1e-9)) { hit = true; return true; }
        return false;
      },
    });
    if (hit) return true;
  }
  return false;
}

export interface RegionCutResult {
  a: Manifold;
  b: Manifold;
  plane: Plane;
  /** Flat disc radius on a curved joint (pins and numbering), undefined for plane cuts. */
  faceRadius?: number;
  planar: boolean;
  /** Mode actually used. */
  used: 'surface' | 'plane' | 'shell';
  warnings: string[];
}

/** Builds and validates the two manifolds of a region split. */
function toSolids(wasm: Wasm, part: Manifold, split: RegionSplit, shell: boolean): { a: Manifold; b: Manifold } {
  const a = meshDataToManifold(wasm, split.a);
  const b = meshDataToManifold(wasm, split.b);
  const fail = (msg: string) => {
    a.delete();
    b.delete();
    throw new LoopError(msg);
  };
  if (a.status() !== 'NoError' || b.status() !== 'NoError' || a.isEmpty() || b.isEmpty()) fail('As peças geradas não ficaram fechadas.');
  const va = a.volume(), vb = b.volume(), v = Math.abs(part.volume());
  if (va <= v * 1e-6 || vb <= v * 1e-6) fail('Uma das peças ficou com volume nulo.');
  if (Math.abs(va + vb - v) > v * 0.01) fail(shell ? 'A casca invade a peça.' : 'Os volumes das peças não fecham com a peça original.');
  return { a, b };
}

/**
 * Executes a `cut-region` operation on a part. The region is recomputed from the stored
 * balls and level on this exact mesh; `ctx` must be built from `part`'s mesh.
 */
export function cutRegion(wasm: Wasm, part: Manifold, ctx: RegionContext, op: RegionCutOperation): RegionCutResult {
  const field = regionField(ctx, op.balls, op.seeds, op.negSeeds);
  const band = Math.max(ctx.edge * 2, Math.min(op.level * 0.35, ctx.diag * 0.05));
  const labels = labelFaces(ctx, field, op.level, band);
  const warnings: string[] = [];
  const planeFallback = (why: string): RegionCutResult => {
    const res = cutByPlane(wasm, part, op.plane, undefined, op.seeds);
    warnings.push(`Corte curvo indisponível (${why}); usado corte plano.`);
    return { ...res, plane: op.plane, planar: true, used: 'plane', warnings };
  };
  if (op.mode === 'plane') {
    const res = cutByPlane(wasm, part, op.plane, undefined, op.seeds);
    return { ...res, plane: op.plane, planar: true, used: 'plane', warnings };
  }
  const shell = op.mode === 'shell';
  try {
    const split = splitRegion(ctx, labels, { mode: shell ? 'shell' : 'surface', depth: op.depth, towards: field.centroid });
    const { a, b } = toSolids(wasm, part, split, shell);
    const faceRadius = split.faceRadius >= 1.5 ? split.faceRadius : undefined;
    return { a, b, plane: split.plane, faceRadius, planar: !shell && !!faceRadius, used: shell ? 'shell' : 'surface', warnings };
  } catch (e) {
    if (op.mode === 'auto' && (e instanceof LoopError || e instanceof CutError)) return planeFallback(e.message.replace(/\.$/, '').toLowerCase());
    if (e instanceof LoopError) throw new CutError(e.message, shell ? 'smaller-depth' : 'use-region');
    throw e;
  }
}
