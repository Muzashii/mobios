import { Box3, Vector3 } from 'three';
import type { Manifold } from 'manifold-3d';
import { CutError, cutByPlane } from './cut';
import { partLabelsOn } from './partmap';
import { SolidGrid } from './segment/volume';
import { planeFrame } from './math';
import { buildTopology } from './mesh/topology';
import { trianglesIntersect } from './mesh/tritri';
import { smoothBoundary } from './segment/smoothBoundary';
import { meshDataToManifold } from './repair';
import { boundaryLoops, fitPlane, fixPinches, labelFaces, LoopError, regionField, snapToCreases, type RegionContext } from './segment/region';
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
export function splitRegion(ctx: RegionContext, faceLabels: Uint8Array, opts: { mode: 'surface' | 'shell'; depth?: number; towards: Vec3; smooth?: boolean }): RegionSplit {
  let topo = ctx.topo;
  let labels = faceLabels;
  let splitFrom: Uint32Array | null = null;
  let loopsIdx = boundaryLoops(topo, labels);
  if (!loopsIdx.length) throw new LoopError('A região não tem contorno: ela já é uma peça separada.');
  // Clean joint line: cut the triangles along a smoothed border instead of following their
  // edges (the staircase). Same number of loops or nothing changes.
  if (opts.mode === 'surface' && opts.smooth !== false) {
    const sm = smoothBoundary(topo, labels);
    if (sm) {
      const t2 = buildTopology(sm.mesh);
      try {
        const l2 = boundaryLoops(t2, sm.labels);
        if (l2.length === loopsIdx.length) {
          topo = t2;
          labels = sm.labels;
          loopsIdx = l2;
          splitFrom = sm.splitFrom;
        }
      } catch (e) {
        if (!(e instanceof LoopError)) throw e;
      }
    }
  }
  const pos: number[] = Array.from(topo.p);
  const aTris: number[] = [];
  const bTris: number[] = [];
  for (let f = 0; f < topo.nf; f++) (labels[f] ? bTris : aTris).push(topo.t[f * 3], topo.t[f * 3 + 1], topo.t[f * 3 + 2]);

  // Original faces a loop vertex touches by construction: around it (two rings), or for a vertex
  // created on an edge, around both ends of that edge. Topological, not by distance: a body
  // 0.5 mm away (an arm next to the torso) is still checked.
  const nv0 = ctx.topo.nv;
  const ring = (v: number) => {
    const { vFaceStart, vFaces, vStart, vNbr } = ctx.topo;
    const out = new Set<number>();
    for (const w of [v, ...vNbr.subarray(vStart[v], vStart[v + 1])]) for (let k = vFaceStart[w]; k < vFaceStart[w + 1]; k++) out.add(vFaces[k]);
    return [...out];
  };
  const touching = new Map<number, Set<number>>();
  for (const v of loopsIdx.flat())
    touching.set(v, new Set(v < nv0 ? ring(v) : splitFrom ? [...ring(splitFrom[(v - nv0) * 2]), ...ring(splitFrom[(v - nv0) * 2 + 1])] : []));
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
      // Cap variants, best first: flat centre (pins), plain blend, then domes bulging into B
      // (away from a body that comes close to the joint, e.g. the torso next to an armpit).
      const variants = [
        { flat: isMain, bulge: 0 },
        { flat: false, bulge: 0 },
        { flat: false, bulge: 0.35 },
        { flat: false, bulge: 0.7 },
      ];
      let done = false;
      for (const v of variants) {
        const mark = pos.length;
        let cap: ReturnType<typeof buildCap>;
        try {
          cap = buildCap(loopsIdx[i], plane, pos, ctx.edge, v.flat, v.bulge);
        } catch (e) {
          pos.length = mark;
          if (e instanceof LoopError) continue;
          throw e;
        }
        if (capPierces(ctx, pos, cap.tris, touching)) {
          pos.length = mark;
          continue;
        }
        if (isMain) {
          faceRadius = cap.flatRadius;
          origin = cap.centre;
        }
        bTris.push(...cap.tris);
        for (let k = 0; k < cap.tris.length; k += 3) aTris.push(cap.tris[k], cap.tris[k + 2], cap.tris[k + 1]);
        done = true;
        break;
      }
      if (!done) throw new LoopError('A tampa curva atravessa a superfície da peça.');
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
export function buildCap(loop: number[], plane: Plane, pos: number[], edge: number, flatCentre: boolean, bulge = 0): { tris: number[]; flatRadius: number; centre: Vec3 } {
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
    // Dome: bulge·ρ at the centre, fading to 0 at the ring.
    const dome = bulge * rho * (1 - s * s);
    // Outer rings drift from the smoothed outline to the exact loop, so the last band of
    // triangles does not twist (radial streaks along the joint line).
    const e = s ** 4;
    rings.push(q.map(([x, y], i) => toWorld(cx + (x + (local[i][0] - x) * e - cx) * s, cy + (y + (local[i][1] - y) * e - cy) * s, zc + (local[i][2] - zc) * w + dome)));
  }
  rings.push(loop);
  const centre = toWorld(cx, cy, zc + bulge * rho);
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

/**
 * Does any cap triangle cross the original surface? (BVH culling + exact tri–tri test.)
 * Triangles touching the cap at a loop vertex are skipped: they meet by construction, at a
 * shared vertex or, after a smoothed cut, at a point on one of their edges (`touching`: the
 * original faces around each loop vertex).
 */
function capPierces(ctx: RegionContext, pos: number[], tris: number[], touching?: Map<number, Set<number>>): boolean {
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
      intersectsTriangle: (tri, triIndex) => {
        const vs = [tri.a, tri.b, tri.c];
        // Shared loop vertices touch by construction: skip triangles that share one.
        for (const p of vs) for (let j = 0; j < 3; j++) if (p.x === T[j * 3] && p.y === T[j * 3 + 1] && p.z === T[j * 3 + 2]) return false;
        if (touching) for (let j = 0; j < 3; j++) if (touching.get(tris[k + j])?.has(triIndex)) return false;
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

/**
 * Cut along the border of detected parts: B = the automatic parts under `partSeeds`, from the
 * part map of this exact solid. The border gets the smoothed joint line and a cap like any
 * region cut; if no cap closes, a plane fitted to the border cuts instead.
 */
function cutDetectedParts(wasm: Wasm, part: Manifold, ctx: RegionContext, op: RegionCutOperation): RegionCutResult {
  const parts = partLabelsOn(part, ctx.mesh);
  const want = new Set<number>();
  const seedFaces: number[] = [];
  for (const s of op.partSeeds!) {
    const hit = ctx.query.closest(s);
    if (hit) {
      want.add(parts[hit.face]);
      seedFaces.push(hit.face);
    }
  }
  const base = new Uint8Array(ctx.topo.nf);
  for (let f = 0; f < base.length; f++) if (want.has(parts[f])) base[f] = 1;
  cleanLabels(ctx, base, seedFaces, parts);
  const area = (l: Uint8Array) => l.reduce((s, v, f) => s + (v ? ctx.topo.fArea[f] : 0), 0);
  if (!area(base) || area(base) >= ctx.topo.totalArea * 0.999) throw new CutError('Escolha uma parte que não seja a peça inteira.');
  // The map's border is approximate: settle it on the real crease nearby (neck, shoulder, brim).
  // If its cap cannot close, the same crease a ring or two further in or out usually can.
  const band = Math.max(3 * ctx.edge, ctx.diag * 0.04);
  const variants: [number, number][] = [[band, 0], [band * 0.5, 0], [band, 1], [band, -1]];
  const warnings: string[] = [];
  let last: unknown;
  let labels: Uint8Array = base;
  for (const [w, shift] of variants) {
    labels = snapToCreases(ctx.topo, base, w);
    cleanLabels(ctx, labels, seedFaces, parts);
    if (shift) shiftBorder(ctx, labels, shift);
    cleanLabels(ctx, labels, seedFaces, parts);
    try {
      const split = splitRegion(ctx, labels, { mode: 'surface', towards: centroidOf(ctx, labels) });
      const { a, b } = toSolids(wasm, part, split, false);
      const faceRadius = split.faceRadius >= 1.5 ? split.faceRadius : undefined;
      if (shift || w !== band) warnings.push('Emenda ajustada um pouco para a tampa caber.');
      return { a, b, plane: split.plane, faceRadius, planar: !!faceRadius, used: 'surface', warnings };
    } catch (e) {
      if (!(e instanceof LoopError || e instanceof CutError)) throw e;
      last = e;
    }
  }
  // Borders no cap can close (long hair resting on the back): split the volume itself.
  try {
    const { a, b } = volumetricSplit(wasm, part, ctx, labels);
    const plane = fitPlane(boundaryLoops(ctx.topo, labels).reduce((x, y) => (y.length > x.length ? y : x)).map((v) => at(ctx.topo.p, v)), centroidOf(ctx, labels)).plane;
    warnings.push('Junta curva livre: a emenda segue o meio entre as partes (sem área plana para pinos).');
    return { a, b, plane, planar: false, used: 'surface', warnings };
  } catch (e) {
    if (!(e instanceof LoopError || e instanceof CutError)) throw e;
    last = e;
  }
  // Plane through the border, normal towards the part that leaves, limited to a sphere around
  // the border: it cuts the neck, not the long hair hanging past it.
  const centroid = centroidOf(ctx, labels);
  let main: Vec3[] = [];
  try {
    main = boundaryLoops(ctx.topo, labels)
      .reduce((x, y) => (y.length > x.length ? y : x), [] as number[])
      .map((v) => at(ctx.topo.p, v));
  } catch {
    // keep the stored plane
  }
  const plane = main.length >= 3 ? fitPlane(main, centroid).plane : op.plane;
  let res: ReturnType<typeof cutByPlane>;
  try {
    const radius = main.reduce((r, q) => Math.max(r, Math.hypot(q[0] - plane.origin[0], q[1] - plane.origin[1], q[2] - plane.origin[2])), 0) * 1.15;
    if (!radius) throw new CutError('sem contorno');
    res = cutByPlane(wasm, part, plane, { center: plane.origin, radius }, [centroid]);
  } catch (e) {
    if (!(e instanceof CutError)) throw e;
    res = cutByPlane(wasm, part, plane, undefined, [centroid]);
  }
  warnings.push(`Corte curvo indisponível (${(last as Error).message.replace(/\.$/, '').toLowerCase()}); usado corte plano.`);
  return { ...res, plane, planar: true, used: 'plane', warnings };
}

/**
 * Splits the solid by which part's surface is nearest inside it: voxel labels spread from the
 * surface inwards, a smoothed indicator becomes the field of a level set, and the halves are the
 * exact booleans of the part with it. The joint follows the middle between the two surfaces,
 * so it works where a cap cannot (hair hanging over the back, parts wrapping each other).
 */
function volumetricSplit(wasm: Wasm, part: Manifold, ctx: RegionContext, labels: Uint8Array): { a: Manifold; b: Manifold } {
  const { mesh, query, topo } = ctx;
  const box = part.boundingBox();
  const longest = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const h = longest / 140;
  const grid = new SolidGrid(mesh, query, h);
  const [nx, ny, nz] = grid.n;
  const lab = new Int8Array(nx * ny * nz).fill(-1);
  const cell = (x: number, y: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - grid.min[0]) / h)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - grid.min[1]) / h)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - grid.min[2]) / h)));
    return i + nx * (j + ny * k);
  };
  const queue: number[] = [];
  const { p, t } = topo;
  for (let f = 0; f < topo.nf; f++) {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const span = Math.max(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]), Math.hypot(p[b] - p[c], p[b + 1] - p[c + 1], p[b + 2] - p[c + 2]), Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]));
    const steps = Math.max(1, Math.ceil(span / h));
    for (let i = 0; i <= steps; i++)
      for (let j = 0; i + j <= steps; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        const id = cell(p[a] * w + p[b] * u + p[c] * v, p[a + 1] * w + p[b + 1] * u + p[c + 1] * v, p[a + 2] * w + p[b + 2] * u + p[c + 2] * v);
        if (lab[id] < 0) {
          lab[id] = labels[f];
          queue.push(id);
        }
      }
  }
  // Nearest surface label everywhere (breadth-first, 6-neighbourhood).
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q];
    const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
    const nb = [i > 0 ? id - 1 : -1, i < nx - 1 ? id + 1 : -1, j > 0 ? id - nx : -1, j < ny - 1 ? id + nx : -1, k > 0 ? id - nx * ny : -1, k < nz - 1 ? id + nx * ny : -1];
    for (const m of nb)
      if (m >= 0 && lab[m] < 0) {
        lab[m] = lab[id];
        queue.push(m);
      }
  }
  // Smoothed indicator of B (two box blurs) sampled trilinearly: the level-set field.
  let ind: Float32Array = Float32Array.from(lab, (v) => (v === 1 ? 1 : 0));
  for (let pass = 0; pass < 2; pass++)
    for (const [stride, n] of [[1, nx], [nx, ny], [nx * ny, nz]] as const) {
      const out = new Float32Array(ind.length);
      for (let id = 0; id < ind.length; id++) {
        const c = Math.floor(id / stride) % n;
        const lo = c > 0 ? ind[id - stride] : ind[id], hi = c < n - 1 ? ind[id + stride] : ind[id];
        out[id] = (lo + 2 * ind[id] + hi) / 4;
      }
      ind = out;
    }
  const at3 = (i: number, j: number, k: number) => ind[Math.min(nx - 1, Math.max(0, i)) + nx * (Math.min(ny - 1, Math.max(0, j)) + ny * Math.min(nz - 1, Math.max(0, k)))];
  const field = (q: [number, number, number]) => {
    const x = (q[0] - grid.min[0]) / h - 0.5, y = (q[1] - grid.min[1]) / h - 0.5, z = (q[2] - grid.min[2]) / h - 0.5;
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const fx = x - i, fy = y - j, fz = z - k;
    let v = 0;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) v += at3(i + dx, j + dy, k + dz) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    return v - 0.5;
  };
  const region = wasm.Manifold.levelSet(field, { min: grid.min, max: [grid.min[0] + nx * h, grid.min[1] + ny * h, grid.min[2] + nz * h] }, h);
  const b = part.intersect(region);
  const a = part.subtract(region);
  region.delete();
  const v = Math.abs(part.volume());
  if (a.isEmpty() || b.isEmpty() || a.volume() < v * 1e-4 || b.volume() < v * 1e-4 || Math.abs(a.volume() + b.volume() - v) > v * 0.01) {
    a.delete();
    b.delete();
    throw new LoopError('A divisão pelo volume não fechou.');
  }
  return { a, b };
}

/** Area centroid of the B faces. */
function centroidOf(ctx: RegionContext, labels: Uint8Array): Vec3 {
  const { p, t, fArea } = ctx.topo;
  const c: Vec3 = [0, 0, 0];
  let area = 0;
  for (let f = 0; f < labels.length; f++) {
    if (!labels[f]) continue;
    area += fArea[f];
    for (let k = 0; k < 3; k++) c[k] += (fArea[f] * (p[t[f * 3] * 3 + k] + p[t[f * 3 + 1] * 3 + k] + p[t[f * 3 + 2] * 3 + k])) / 3;
  }
  return area ? [c[0] / area, c[1] / area, c[2] / area] : c;
}

/** Moves the border by whole rings of faces: positive grows B, negative shrinks it. */
function shiftBorder(ctx: RegionContext, labels: Uint8Array, rings: number) {
  const { faceNbr, nf } = ctx.topo;
  const grow = rings > 0 ? 1 : 0;
  for (let r = 0; r < Math.abs(rings); r++) {
    const flip: number[] = [];
    for (let f = 0; f < nf; f++) {
      if (labels[f] === grow) continue;
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g >= 0 && labels[g] === grow) {
          flip.push(f);
          break;
        }
      }
    }
    for (const f of flip) labels[f] = grow;
  }
}

/**
 * Labels carried from the part map are a little noisy at the borders: keep the pieces of B that
 * hold a clicked point, give B every piece of A cut off from the main body (islands inside B, a
 * hat on a head that leaves), and resolve pinched vertices so the border is made of clean loops.
 */
function cleanLabels(ctx: RegionContext, labels: Uint8Array, seedFaces: number[], parts: ArrayLike<number>) {
  const { nf, faceNbr, fArea } = ctx.topo;
  const comp = new Int32Array(nf).fill(-1);
  const comps: { side: number; area: number; faces: number[] }[] = [];
  for (let s = 0; s < nf; s++) {
    if (comp[s] >= 0) continue;
    const id = comps.length, side = labels[s];
    const faces = [s];
    comp[s] = id;
    let area = 0;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      area += fArea[f];
      for (let j = 0; j < 3; j++) {
        const g = faceNbr[f * 3 + j];
        if (g >= 0 && comp[g] < 0 && labels[g] === side) {
          comp[g] = id;
          faces.push(g);
        }
      }
    }
    comps.push({ side, area, faces });
  }
  const keep = new Set(seedFaces.map((f) => comp[f]));
  // The body is the piece of A made of the most detected parts (torso, head, arms…); pieces
  // that are one part hanging only from B (a hat on a head, feet under a skirt) leave with it.
  // Size does not decide: a hat can have more surface than the rest of a small figure.
  let mainA: (typeof comps)[number] | undefined;
  let best = -1;
  for (const c of comps) {
    if (c.side !== 0) continue;
    const kinds = new Set<number>();
    for (const f of c.faces) kinds.add(parts[f]);
    const score = kinds.size * 1e12 + c.area;
    if (score > best) {
      best = score;
      mainA = c;
    }
  }
  for (const [i, c] of comps.entries()) {
    if (c.side === 1 && !keep.has(i)) for (const f of c.faces) labels[f] = 0;
    // Whatever the cut would leave hanging in the air goes with B (a hat when the head leaves).
    else if (c.side === 0 && c !== mainA) for (const f of c.faces) labels[f] = 1;
  }
  for (let it = 0; it < 8 && fixPinches(ctx.topo, labels); it++);
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
  if (op.partSeeds?.length) return cutDetectedParts(wasm, part, ctx, op);
  const field = regionField(ctx, op.balls, op.seeds, op.negSeeds);
  const labelsAt = (level: number) => labelFaces(ctx, field, level, Math.max(ctx.edge * 2, Math.min(level * 0.35, ctx.diag * 0.05)));
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
  // The stored level first; if its cap cannot close, the ring a little further along or back
  // usually can (the surface next to a joint is rarely bad on both sides).
  const levels = shell ? [op.level] : [op.level, op.level * 1.15, op.level * 0.87, op.level * 1.3];
  let last: unknown;
  for (const level of levels) {
    try {
      const split = splitRegion(ctx, labelsAt(level), { mode: shell ? 'shell' : 'surface', depth: op.depth, towards: field.centroid });
      const { a, b } = toSolids(wasm, part, split, shell);
      const faceRadius = split.faceRadius >= 1.5 ? split.faceRadius : undefined;
      if (level !== op.level) warnings.push(`Emenda deslocada ${Math.abs(level - op.level).toFixed(1)} mm para a tampa caber.`);
      return { a, b, plane: split.plane, faceRadius, planar: !shell && !!faceRadius, used: shell ? 'shell' : 'surface', warnings };
    } catch (e) {
      if (!(e instanceof LoopError || e instanceof CutError)) throw e;
      last = e;
    }
  }
  const e = last as Error;
  if (op.mode === 'auto') return planeFallback(e.message.replace(/\.$/, '').toLowerCase());
  if (e instanceof LoopError) throw new CutError(e.message, shell ? 'smaller-depth' : 'use-region');
  throw e;
}
