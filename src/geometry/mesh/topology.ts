import type { MeshData } from '../types';

/**
 * Connectivity and per-element attributes of an indexed triangle mesh, built once per part
 * version and shared by SmartCut, the region cut and the mesh inspection.
 * All arrays are flat typed arrays (500k+ triangles stay cheap).
 */
export interface Topology {
  nv: number;
  nf: number;
  p: Float32Array;
  t: Uint32Array;
  /** CSR: neighbours of v are vNbr[vStart[v] .. vStart[v + 1]) (unique). */
  vStart: Uint32Array;
  vNbr: Uint32Array;
  /** CSR: faces around v are vFaces[vFaceStart[v] .. vFaceStart[v + 1]). */
  vFaceStart: Uint32Array;
  vFaces: Uint32Array;
  /** Face across edge k of face f (edge k runs t[3f+k] → t[3f+(k+1)%3]); −1 on boundary / non-manifold. */
  faceNbr: Int32Array;
  /** Unit face normals and areas. */
  fNormal: Float32Array;
  fArea: Float64Array;
  /** Area-weighted unit vertex normals and one third of the incident area. */
  vNormal: Float32Array;
  vArea: Float64Array;
  totalArea: number;
}

export function buildTopology(mesh: MeshData): Topology {
  const { positions: p, indices: t } = mesh;
  const nv = p.length / 3;
  const nf = t.length / 3;

  // Outgoing half-edges per vertex (CSR). Half-edge id = 3f + k.
  const heStart = new Uint32Array(nv + 1);
  for (let i = 0; i < t.length; i++) heStart[t[i] + 1]++;
  for (let v = 0; v < nv; v++) heStart[v + 1] += heStart[v];
  const heFill = heStart.slice(0, nv);
  const heOut = new Uint32Array(t.length);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) heOut[heFill[t[f * 3 + k]]++] = f * 3 + k;
  const vFaces = new Uint32Array(t.length);
  for (let i = 0; i < t.length; i++) vFaces[i] = (heOut[i] - (heOut[i] % 3)) / 3;
  const to = (he: number) => t[(he - (he % 3)) + ((he % 3) + 1) % 3];

  // Twin across each edge: the single opposite half-edge b → a.
  const faceNbr = new Int32Array(t.length).fill(-1);
  for (let he = 0; he < t.length; he++) {
    const a = t[he], b = to(he);
    let twin = -1, count = 0;
    for (let i = heStart[b]; i < heStart[b + 1]; i++) {
      const h = heOut[i];
      if (to(h) === a) { twin = h; count++; }
    }
    // Same-direction duplicates make the edge non-manifold too.
    let same = 0;
    for (let i = heStart[a]; i < heStart[a + 1]; i++) if (to(heOut[i]) === b) same++;
    if (count === 1 && same === 1) faceNbr[he] = (twin - (twin % 3)) / 3;
  }

  // Unique vertex neighbours (outgoing + incoming, so boundary vertices are complete).
  const mark = new Int32Array(nv).fill(-1);
  const counts = new Uint32Array(nv + 1);
  const tmp: number[] = [];
  const lists: Uint32Array[] = new Array(nv);
  for (let v = 0; v < nv; v++) {
    tmp.length = 0;
    for (let i = heStart[v]; i < heStart[v + 1]; i++) {
      const he = heOut[i];
      const w = to(he);
      if (mark[w] !== v) { mark[w] = v; tmp.push(w); }
      // Previous vertex of the face (incoming edge w' → v).
      const f = (he - (he % 3)) / 3, k = he % 3;
      const prev = t[f * 3 + (k + 2) % 3];
      if (mark[prev] !== v) { mark[prev] = v; tmp.push(prev); }
    }
    lists[v] = Uint32Array.from(tmp);
    counts[v + 1] = counts[v] + tmp.length;
  }
  const vNbr = new Uint32Array(counts[nv]);
  for (let v = 0; v < nv; v++) vNbr.set(lists[v], counts[v]);

  const fNormal = new Float32Array(nf * 3);
  const fArea = new Float64Array(nf);
  const vN = new Float64Array(nv * 3);
  const vArea = new Float64Array(nv);
  let totalArea = 0;
  for (let f = 0; f < nf; f++) {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    const l = Math.hypot(cx, cy, cz);
    const ar = l / 2;
    fArea[f] = ar;
    totalArea += ar;
    if (l > 0) { fNormal[f * 3] = cx / l; fNormal[f * 3 + 1] = cy / l; fNormal[f * 3 + 2] = cz / l; }
    for (let k = 0; k < 3; k++) {
      const v = t[f * 3 + k];
      vArea[v] += ar / 3;
      vN[v * 3] += cx; vN[v * 3 + 1] += cy; vN[v * 3 + 2] += cz;
    }
  }
  const vNormal = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(vN[v * 3], vN[v * 3 + 1], vN[v * 3 + 2]) || 1;
    vNormal[v * 3] = vN[v * 3] / l; vNormal[v * 3 + 1] = vN[v * 3 + 1] / l; vNormal[v * 3 + 2] = vN[v * 3 + 2] / l;
  }
  return { nv, nf, p, t, vStart: counts, vNbr, vFaceStart: heStart, vFaces, faceNbr, fNormal, fArea, vNormal, vArea, totalArea };
}

export const vdist = (p: Float32Array, a: number, b: number) =>
  Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);

/**
 * Signed dihedral "fold" of edge k of face f, in radians: > 0 concave (valley), < 0 convex
 * (ridge), 0 flat or boundary.
 */
export function edgeFold(topo: Topology, f: number, k: number): number {
  const g = topo.faceNbr[f * 3 + k];
  if (g < 0) return 0;
  const { fNormal: n, p, t } = topo;
  const cos = Math.max(-1, Math.min(1, n[f * 3] * n[g * 3] + n[f * 3 + 1] * n[g * 3 + 1] + n[f * 3 + 2] * n[g * 3 + 2]));
  const angle = Math.acos(cos);
  // Concave when the neighbour's far vertex lies above f's plane.
  let far = -1;
  for (let j = 0; j < 3; j++) {
    const v = t[g * 3 + j];
    if (v !== t[f * 3 + k] && v !== t[f * 3 + (k + 1) % 3]) far = v;
  }
  if (far < 0) return 0;
  const a = t[f * 3];
  const side = (p[far * 3] - p[a * 3]) * n[f * 3] + (p[far * 3 + 1] - p[a * 3 + 1]) * n[f * 3 + 1] + (p[far * 3 + 2] - p[a * 3 + 2]) * n[f * 3 + 2];
  return side > 0 ? angle : -angle;
}

/** Binary min-heap on (key, id) with typed storage; decrease-key by lazy re-insertion. */
export class MinHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }
  push(id: number, key: number) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2), keys = new Float64Array(this.size * 2);
      ids.set(this.ids); keys.set(this.keys);
      this.ids = ids; this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.ids[i] = this.ids[parent]; this.keys[i] = this.keys[parent];
      i = parent;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  /** Key of the top element (call before pop). */
  topKey() {
    return this.keys[0];
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size], lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const m = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[m] >= lastKey) break;
      this.ids[i] = this.ids[m]; this.keys[i] = this.keys[m];
      i = m;
    }
    this.ids[i] = lastId; this.keys[i] = lastKey;
    return top;
  }
}

/** Multi-source Dijkstra on the vertex graph (edge length metric, optionally reweighted). */
export function geodesic(topo: Topology, sources: ArrayLike<number>, weight?: (a: number, b: number, len: number) => number): Float64Array {
  const { nv, p, vStart, vNbr } = topo;
  const d = new Float64Array(nv).fill(Infinity);
  const heap = new MinHeap(Math.max(1024, sources.length * 2));
  for (let i = 0; i < sources.length; i++) {
    d[sources[i]] = 0;
    heap.push(sources[i], 0);
  }
  while (heap.size) {
    const key = heap.topKey();
    const v = heap.pop();
    if (key > d[v]) continue;
    for (let k = vStart[v]; k < vStart[v + 1]; k++) {
      const w = vNbr[k];
      const len = vdist(p, v, w);
      const nd = key + (weight ? weight(v, w, len) : len);
      if (nd < d[w]) { d[w] = nd; heap.push(w, nd); }
    }
  }
  return d;
}

/** Union-find with path halving. */
export class DisjointSet {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n).fill(-1);
  }
  add(x: number) {
    this.parent[x] = x;
  }
  has(x: number) {
    return this.parent[x] !== -1;
  }
  find(x: number): number {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }
}
