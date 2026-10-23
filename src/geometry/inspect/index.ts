import { toDisplayMesh } from '../display';
import { MeshQuery } from '../mesh/bvh';
import { selfIntersections } from '../mesh/tritri';
import { cleanTriangles, weldVertices } from '../repair';
import type { Bounds, InspectionReport, IssueMarkers, MeshData, MeshIssue, Technology, Vec3 } from '../types';

/**
 * Raio-X da malha: a non-destructive diagnosis of a raw imported mesh. Nothing is changed
 * here — the report lists every problem with its location (heatmap markers) and the repair
 * options the user can pick (first option = recommended). See inspect/repairPlan.ts.
 */
export interface InspectOptions {
  technology: Technology;
  /** Printer build volume X × Y × Z (mm). */
  buildVolume?: Vec3;
  /** Time budget for the self-intersection search (ms). */
  intersectionBudgetMs?: number;
}

/** Minimum printable wall per technology (mm). */
export const MIN_WALL: Record<Technology, number> = { FDM: 0.8, RESINA: 0.4 };

const MAX_MARKER_FLOATS = 600_000;

/** Facts about the raw mesh shared by the inspection and the repair. */
export interface MeshFacts {
  mesh: MeshData;
  /** Faces removed as degenerate / duplicate before analysis. */
  degenerate: number;
  duplicate: number;
  boundaryEdges: [number, number][];
  boundaryLoops: number;
  nonManifoldEdges: [number, number][];
  nonManifoldVertices: number[];
  /** Undirected edges whose two faces disagree on direction. */
  flippedEdges: number;
  shellOf: Int32Array;
  shells: ShellInfo[];
}

export interface ShellInfo {
  id: number;
  faces: number;
  volume: number;
  area: number;
  closed: boolean;
  bounds: Bounds;
  genus: number;
  /** Smallest shell that contains this one (−1 = none). */
  container: number;
}

/** Topological analysis of a welded, cleaned mesh. */
export function meshFacts(positions: Float32Array, indices?: Uint32Array): MeshFacts {
  const welded = weldVertices(positions, indices);
  const notes: string[] = [];
  const tris = cleanTriangles(welded, notes);
  const count = (re: RegExp) => Number(notes.find((n) => re.test(n))?.match(/^\d+/)?.[0] ?? 0);
  const degenerate = count(/degenerada/), duplicate = count(/duplicada/);
  const p = welded.positions;
  const t = tris;
  const nv = p.length / 3, nf = t.length / 3;

  // Outgoing half-edges per vertex (CSR).
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < t.length; i++) start[t[i] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nv);
  const out = new Uint32Array(t.length);
  for (let he = 0; he < t.length; he++) out[fill[t[he]]++] = he;
  const to = (he: number) => t[he - (he % 3) + ((he % 3) + 1) % 3];
  const countDir = (a: number, b: number) => {
    let n = 0;
    for (let i = start[a]; i < start[a + 1]; i++) if (to(out[i]) === b) n++;
    return n;
  };

  const boundaryEdges: [number, number][] = [];
  const nmSet = new Map<number, [number, number]>();
  const flipped = new Set<number>();
  const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let he = 0; he < t.length; he++) {
    const a = t[he], b = to(he);
    const same = countDir(a, b), opp = countDir(b, a);
    if (same + opp > 2) nmSet.set(key(a, b), a < b ? [a, b] : [b, a]);
    else if (opp === 0 && same === 1) boundaryEdges.push([a, b]);
    else if (same === 2 && opp === 0) flipped.add(key(a, b));
  }
  const flippedEdges = flipped.size;

  // Boundary loops ≈ connected components of the boundary edge graph.
  const bParent = new Map<number, number>();
  const bFind = (x: number): number => {
    let r = x;
    while (bParent.get(r) !== r) r = bParent.get(r)!;
    let c = x;
    while (bParent.get(c) !== r) { const n = bParent.get(c)!; bParent.set(c, r); c = n; }
    return r;
  };
  for (const [a, b] of boundaryEdges) {
    if (!bParent.has(a)) bParent.set(a, a);
    if (!bParent.has(b)) bParent.set(b, b);
    const ra = bFind(a), rb = bFind(b);
    if (ra !== rb) bParent.set(rb, ra);
  }
  const loopRoots = new Set<number>();
  for (const v of bParent.keys()) loopRoots.add(bFind(v));

  // Non-manifold vertices: the faces around them form more than one fan.
  const vFaces = new Uint32Array(t.length);
  for (let i = 0; i < t.length; i++) vFaces[i] = (out[i] - (out[i] % 3)) / 3;
  const nonManifoldVertices: number[] = [];
  for (let v = 0; v < nv; v++) {
    const s = start[v], e = start[v + 1];
    if (e - s < 2) continue;
    const fs = Array.from(vFaces.subarray(s, e));
    const parent = fs.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      // Faces of the same fan share an edge through v (a second common vertex).
      let shared = 0;
      for (let k = 0; k < 3; k++) {
        const x = t[fs[i] * 3 + k];
        if (x !== v && (t[fs[j] * 3] === x || t[fs[j] * 3 + 1] === x || t[fs[j] * 3 + 2] === x)) shared++;
      }
      if (shared) parent[find(i)] = find(j);
    }
    const fans = new Set(fs.map((_, i) => find(i))).size;
    if (fans > 1) nonManifoldVertices.push(v);
  }

  // Shells: faces connected through shared vertices.
  const vp = new Int32Array(nv).map((_, i) => i);
  const vfind = (x: number): number => {
    while (vp[x] !== x) { vp[x] = vp[vp[x]]; x = vp[x]; }
    return x;
  };
  for (let f = 0; f < nf; f++) {
    const a = vfind(t[f * 3]), b = vfind(t[f * 3 + 1]), c = vfind(t[f * 3 + 2]);
    vp[b] = a;
    vp[vfind(c)] = a;
  }
  const rootId = new Map<number, number>();
  const shellOf = new Int32Array(nf);
  for (let f = 0; f < nf; f++) {
    const r = vfind(t[f * 3]);
    if (!rootId.has(r)) rootId.set(r, rootId.size);
    shellOf[f] = rootId.get(r)!;
  }
  const shells: ShellInfo[] = [...rootId.values()].map((id) => ({
    id, faces: 0, volume: 0, area: 0, closed: true, genus: 0, container: -1,
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
  }));
  for (let f = 0; f < nf; f++) {
    const sh = shells[shellOf[f]];
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    sh.faces++;
    sh.volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    sh.area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) {
      sh.bounds.min[k] = Math.min(sh.bounds.min[k], p[v + k]);
      sh.bounds.max[k] = Math.max(sh.bounds.max[k], p[v + k]);
    }
  }
  // Closedness and genus (Euler characteristic) per shell.
  const shellVerts = new Map<number, Set<number>>();
  const shellEdges = new Map<number, number>();
  for (let f = 0; f < nf; f++) {
    const s = shellOf[f];
    let set = shellVerts.get(s);
    if (!set) shellVerts.set(s, (set = new Set()));
    for (let k = 0; k < 3; k++) set.add(t[f * 3 + k]);
  }
  for (const [a] of boundaryEdges) shells[shellOf[vFaces[start[a]]]].closed = false;
  for (let he = 0; he < t.length; he++) {
    const a = t[he], b = to(he);
    if (a < b || countDir(b, a) === 0) shellEdges.set(shellOf[(he - (he % 3)) / 3], (shellEdges.get(shellOf[(he - (he % 3)) / 3]) ?? 0) + 1);
  }
  for (const sh of shells) {
    if (!sh.closed) continue;
    const chi = (shellVerts.get(sh.id)?.size ?? 0) - (shellEdges.get(sh.id) ?? 0) + sh.faces;
    sh.genus = Math.max(0, Math.round(1 - chi / 2));
  }

  return {
    mesh: { positions: p, indices: t },
    degenerate,
    duplicate,
    boundaryEdges,
    boundaryLoops: loopRoots.size,
    nonManifoldEdges: [...nmSet.values()],
    nonManifoldVertices,
    flippedEdges,
    shellOf,
    shells,
  };
}

/** For each shell, the smallest other shell that contains it (ray parity, one ray per shell). */
export function shellContainment(facts: MeshFacts, query: MeshQuery) {
  const { shells, shellOf, mesh } = facts;
  if (shells.length < 2) return;
  const { positions: p, indices: t } = mesh;
  const firstFace = new Int32Array(shells.length).fill(-1);
  for (let f = 0; f < shellOf.length; f++) if (firstFace[shellOf[f]] < 0) firstFace[shellOf[f]] = f;
  // Asymmetric direction from a face centroid: never runs along a box diagonal into a corner.
  const dir: Vec3 = [0.3123, 0.5234, 0.7929];
  for (const sh of shells) {
    const f = firstFace[sh.id];
    if (f < 0) continue;
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const o: Vec3 = [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3];
    const counts = new Map<number, number>();
    for (const h of query.hits(o, dir, 1e-7)) {
      const s = shellOf[h.face];
      if (s !== sh.id) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    let best = -1;
    for (const [s, c] of counts) {
      if (c % 2 === 1 && (best < 0 || Math.abs(shells[s].volume) < Math.abs(shells[best].volume))) best = s;
    }
    sh.container = best;
  }
}

const boundsOf = (pts: ArrayLike<number>): Bounds | undefined => {
  if (pts.length < 3) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pts[i + k]);
    max[k] = Math.max(max[k], pts[i + k]);
  }
  return { min, max };
};

function edgeMarkers(p: Float32Array, edges: [number, number][]): IssueMarkers {
  const n = Math.min(edges.length, MAX_MARKER_FLOATS / 6);
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const [a, b] = edges[i];
    out.set([p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], i * 6);
  }
  return { type: 'edges', positions: out };
}

function faceMarkers(m: MeshData, faces: ArrayLike<number>): IssueMarkers {
  const n = Math.min(faces.length, MAX_MARKER_FLOATS / 9);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = m.indices[faces[i] * 3 + k] * 3;
    out.set([m.positions[v], m.positions[v + 1], m.positions[v + 2]], i * 9 + k * 3);
  }
  return { type: 'faces', positions: out };
}

function pointMarkers(p: Float32Array, verts: number[]): IssueMarkers {
  const n = Math.min(verts.length, MAX_MARKER_FLOATS / 3);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set([p[verts[i] * 3], p[verts[i] * 3 + 1], p[verts[i] * 3 + 2]], i * 3);
  return { type: 'points', positions: out };
}

const fmt = (n: number) => n.toLocaleString('pt-BR');
const fmtMm = (n: number, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });

/** Debris threshold: tiny floating pieces (mm³). */
export const debrisThreshold = (totalVolume: number) => Math.max(0.5, Math.abs(totalVolume) * 1e-4);

/** Full inspection of a raw mesh (section 4.2 of the SmartCut v2 plan). */
export function inspectMesh(id: string, name: string, positions: Float32Array, indices: Uint32Array | undefined, opts: InspectOptions): InspectionReport {
  const t0 = performance.now();
  const facts = meshFacts(positions, indices);
  const { mesh } = facts;
  const p = mesh.positions, t = mesh.indices;
  const nf = t.length / 3;
  const issues: MeshIssue[] = [];
  const bounds = boundsOf(p) ?? { min: [0, 0, 0], max: [0, 0, 0] };
  const size: Vec3 = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]) as Vec3;
  const longest = Math.max(...size);
  const query = nf ? new MeshQuery(mesh) : null;
  if (query) shellContainment(facts, query);
  const totalVolume = facts.shells.reduce((s, sh) => s + sh.volume, 0);

  // Holes.
  if (facts.boundaryEdges.length) {
    let perimeter = 0;
    for (const [a, b] of facts.boundaryEdges) perimeter += Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
    const markers = edgeMarkers(p, facts.boundaryEdges);
    issues.push({
      kind: 'holes',
      severity: 'warning',
      title: `${fmt(facts.boundaryLoops)} furo(s) na superfície`,
      detail: `${fmt(facts.boundaryEdges.length)} arestas abertas, ${fmtMm(perimeter)} mm de borda no total. A peça precisa ser fechada para cortar e imprimir.`,
      count: facts.boundaryLoops,
      options: [
        { value: 'smooth', label: 'Preencher suave', hint: 'Superfície curva que continua a forma (fairing).' },
        { value: 'flat', label: 'Preencher plano', hint: 'Tampa reta no plano do furo — melhor para furos planos.' },
      ],
      focus: boundsOf(markers.positions),
      markers,
    });
  }

  // Non-manifold edges / vertices.
  if (facts.nonManifoldEdges.length || facts.nonManifoldVertices.length) {
    const markers = facts.nonManifoldEdges.length ? edgeMarkers(p, facts.nonManifoldEdges) : pointMarkers(p, facts.nonManifoldVertices);
    issues.push({
      kind: 'non-manifold',
      severity: facts.nonManifoldEdges.length ? 'critical' : 'warning',
      title: 'Geometria não-manifold',
      detail: `${fmt(facts.nonManifoldEdges.length)} aresta(s) com mais de 2 faces e ${fmt(facts.nonManifoldVertices.length)} vértice(s) onde superfícies se tocam num ponto.`,
      count: facts.nonManifoldEdges.length + facts.nonManifoldVertices.length,
      options: [
        { value: 'remove', label: 'Remover faces excedentes e dividir vértices' },
        { value: 'volumetric', label: 'Remesh volumétrico', hint: 'Reconstrói a malha inteira: sempre fecha, perde detalhe fino.' },
      ],
      focus: boundsOf(markers.positions),
      markers,
    });
  }

  // Orientation: flipped edges and inverted shells (negative volume, not inside anything).
  const inverted = facts.shells.filter((s) => s.closed && s.volume < 0 && s.container < 0);
  if (facts.flippedEdges || inverted.length) {
    const faces: number[] = [];
    for (let f = 0; f < nf && faces.length < 200_000; f++) if (inverted.some((s) => s.id === facts.shellOf[f])) faces.push(f);
    const markers = faces.length ? faceMarkers(mesh, faces) : undefined;
    issues.push({
      kind: 'orientation',
      severity: 'warning',
      title: 'Normais invertidas',
      detail: `${fmt(facts.flippedEdges)} aresta(s) com faces em sentidos opostos${inverted.length ? ` e ${inverted.length} casca(s) inteira(s) virada(s) do avesso` : ''}.`,
      count: facts.flippedEdges + inverted.length,
      options: [
        { value: 'per-shell', label: 'Reorientar por casca', hint: 'Deixa todas as normais para fora.' },
        { value: 'keep', label: 'Manter como está' },
      ],
      focus: markers ? boundsOf(markers.positions) : undefined,
      markers,
    });
  }

  // Self-intersections.
  const si = nf ? selfIntersections(p, t, { budgetMs: opts.intersectionBudgetMs ?? 3000 }) : { pairs: 0, faces: [], pairList: [], complete: true };
  let within = 0, between = 0;
  for (let i = 0; i < si.pairList.length; i += 2) {
    if (facts.shellOf[si.pairList[i]] === facts.shellOf[si.pairList[i + 1]]) within++;
    else between++;
  }
  const overlapping = new Set<number>();
  for (let i = 0; i < si.pairList.length; i += 2) {
    const a = facts.shellOf[si.pairList[i]], b = facts.shellOf[si.pairList[i + 1]];
    if (a !== b) { overlapping.add(a); overlapping.add(b); }
  }
  if (within) {
    const markers = faceMarkers(mesh, si.faces);
    issues.push({
      kind: 'self-intersections',
      severity: 'critical',
      title: 'Autointerseções',
      detail: `${fmt(within)} par(es) de triângulos da mesma casca se atravessam${si.complete ? '' : ' (busca interrompida — pode haver mais)'}. Booleanos e cortes podem falhar nessas regiões.`,
      count: within,
      options: [
        { value: 'volumetric', label: 'Remesh volumétrico', hint: 'Resolve qualquer autointerseção; perde detalhe menor que a resolução.' },
        { value: 'keep', label: 'Manter (arriscado)' },
      ],
      focus: boundsOf(markers.positions),
      markers,
    });
  }

  // Shells: separate bodies, overlapping, internal, debris.
  const main = facts.shells.reduce((x, y) => (Math.abs(y.volume) > Math.abs(x.volume) ? y : x), facts.shells[0]);
  const debrisMax = debrisThreshold(totalVolume);
  const debris = facts.shells.filter((s) => s !== main && s.container < 0 && Math.abs(s.volume) < debrisMax);
  const innerSolid = facts.shells.filter((s) => s.container >= 0 && s.volume > 0);
  const voids = facts.shells.filter((s) => s.container >= 0 && s.volume < 0);
  const separate = facts.shells.filter((s) => s !== main && s.container < 0 && Math.abs(s.volume) >= debrisMax);
  if (facts.shells.length > 1 && (debris.length || innerSolid.length || separate.length || overlapping.size)) {
    const parts: string[] = [];
    if (overlapping.size) parts.push(`${overlapping.size} sobreposta(s)`);
    if (separate.length) parts.push(`${separate.length} corpo(s) separado(s)`);
    if (innerSolid.length) parts.push(`${innerSolid.length} interna(s)`);
    if (debris.length) parts.push(`${debris.length} sujeira(s) flutuante(s) < ${fmtMm(debrisMax, 1)} mm³`);
    const faces: number[] = [];
    const flagged = new Set([...debris, ...innerSolid].map((s) => s.id).concat([...overlapping]));
    for (let f = 0; f < nf && faces.length < 200_000; f++) if (flagged.has(facts.shellOf[f])) faces.push(f);
    const markers = faces.length ? faceMarkers(mesh, faces) : undefined;
    issues.push({
      kind: 'shells',
      severity: overlapping.size || debris.length ? 'warning' : 'info',
      title: `${facts.shells.length} cascas`,
      detail: `${parts.join(' · ')}.`,
      count: facts.shells.length,
      options: [
        { value: 'union', label: 'Unir em um sólido e remover sujeira', hint: 'Recomendado para figuras baixadas (partes modeladas sobrepostas).' },
        { value: 'separate', label: 'Manter como partes separadas', hint: 'Cada corpo vira uma parte no projeto.' },
        { value: 'keep', label: 'Manter tudo junto, sem unir' },
      ],
      focus: markers ? boundsOf(markers.positions) : undefined,
      markers,
    });
  }
  if (voids.length) {
    const faces: number[] = [];
    const ids = new Set(voids.map((s) => s.id));
    for (let f = 0; f < nf && faces.length < 200_000; f++) if (ids.has(facts.shellOf[f])) faces.push(f);
    const markers = faceMarkers(mesh, faces);
    const vol = voids.reduce((s, v) => s - v.volume, 0);
    issues.push({
      kind: 'inner-shells',
      severity: 'info',
      title: `${voids.length} vazio(s) interno(s)`,
      detail: `Cascas viradas para dentro dentro do sólido (${fmtMm(vol, 0)} mm³ de oco). Pode ser um oco intencional.`,
      count: voids.length,
      options: [
        { value: 'keep', label: 'Manter vazio (oco intencional)' },
        { value: 'remove', label: 'Remover (preencher)' },
      ],
      focus: boundsOf(markers.positions),
      markers,
    });
  }

  // Degenerate / duplicate faces (already left out of the analysis mesh).
  if (facts.degenerate + facts.duplicate) {
    issues.push({
      kind: 'degenerate',
      severity: 'info',
      title: 'Faces degeneradas ou duplicadas',
      detail: `${fmt(facts.degenerate)} face(s) com área nula e ${fmt(facts.duplicate)} duplicada(s).`,
      count: facts.degenerate + facts.duplicate,
      options: [{ value: 'remove', label: 'Remover' }],
    });
  }

  // Thin walls (BVH inward rays from area-weighted samples).
  if (query && nf) {
    const limit = MIN_WALL[opts.technology];
    const fArea = new Float64Array(nf);
    let acc = 0;
    for (let f = 0; f < nf; f++) {
      const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
      acc += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      fArea[f] = acc;
    }
    const samples = Math.min(400, nf);
    const thin: number[] = [];
    let minT = Infinity, measured = 0;
    let f = 0;
    for (let s = 0; s < samples; s++) {
      const target = ((s + 0.5) / samples) * acc;
      while (f < nf - 1 && fArea[f] < target) f++;
      const sh = facts.shells[facts.shellOf[f]];
      if (!sh.closed) continue;
      const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
      let n: Vec3 = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      const l = Math.hypot(...n) || 1;
      const sign = sh.volume < 0 ? -1 : 1; // inverted shells point inwards
      n = [(n[0] / l) * sign, (n[1] / l) * sign, (n[2] / l) * sign];
      const cen: Vec3 = [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3];
      const hit = query.first(cen, [-n[0], -n[1], -n[2]], longest * 1e-6);
      if (!hit) continue;
      measured++;
      minT = Math.min(minT, hit.distance);
      if (hit.distance < limit) thin.push(cen[0], cen[1], cen[2]);
    }
    if (thin.length) {
      const pct = (thin.length / 3 / Math.max(1, measured)) * 100;
      const positions = Float32Array.from(thin);
      issues.push({
        kind: 'thin-walls',
        severity: pct > 5 ? 'warning' : 'info',
        title: 'Paredes finas',
        detail: `≈ ${fmtMm(pct, 0)}% da superfície tem parede abaixo de ${limit} mm (${opts.technology === 'FDM' ? 'FDM' : 'resina'}); a mais fina mede ${fmtMm(minT, 2)} mm. Detalhes assim podem não sair na impressão.`,
        count: thin.length / 3,
        options: [{ value: 'warn', label: 'Só avisar' }],
        focus: boundsOf(positions),
        markers: { type: 'points', positions },
      });
    }
  }

  // Scale / unit.
  if (longest > 0 && (longest < 4 || longest > 3000)) {
    const options = longest < 4
      ? [
          { value: longest < 0.5 ? '1000' : '25.4', label: longest < 0.5 ? 'Converter de metros (×1000)' : 'Converter de polegadas (×25,4)' },
          { value: longest < 0.5 ? '25.4' : '10', label: longest < 0.5 ? 'Converter de polegadas (×25,4)' : 'Converter de centímetros (×10)' },
          { value: '1', label: 'Manter em mm' },
        ]
      : [
          { value: longest > 30000 ? '0.001' : '0.1', label: longest > 30000 ? 'Converter de micrômetros (×0,001)' : 'Reduzir 10× (×0,1)' },
          { value: '1', label: 'Manter em mm' },
        ];
    issues.push({
      kind: 'scale',
      severity: 'warning',
      title: 'Escala suspeita',
      detail: `Maior dimensão de ${longest < 4 ? `${fmtMm(longest, 2)} mm` : `${fmtMm(longest / 1000, 2)} m`} — o arquivo pode estar em outra unidade.`,
      count: 1,
      options,
    });
  }

  // Huge meshes.
  if (nf > 1_000_000) {
    issues.push({
      kind: 'huge',
      severity: 'warning',
      title: 'Malha gigante',
      detail: `${fmt(nf)} triângulos. Cortes e o SmartCut ficam lentos; decimar preserva a forma com desvio de centésimos de mm.`,
      count: nf,
      options: [
        { value: '500000', label: 'Decimar para 500 mil' },
        { value: '250000', label: 'Decimar para 250 mil' },
        { value: '0', label: 'Manter' },
      ],
    });
  }

  // Needle triangles.
  let needles = 0;
  const needleFaces: number[] = [];
  for (let f = 0; f < nf; f++) {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const e = [
      (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2,
      (p[b] - p[c]) ** 2 + (p[b + 1] - p[c + 1]) ** 2 + (p[b + 2] - p[c + 2]) ** 2,
      (p[c] - p[a]) ** 2 + (p[c + 1] - p[a + 1]) ** 2 + (p[c + 2] - p[a + 2]) ** 2,
    ];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const area2 = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    if (area2 > 0 && Math.max(...e) / area2 > 25) {
      needles++;
      if (needleFaces.length < 100_000) needleFaces.push(f);
    }
  }
  if (needles > nf * 0.05) {
    const markers = faceMarkers(mesh, needleFaces);
    issues.push({
      kind: 'needles',
      severity: 'info',
      title: 'Triângulos-agulha',
      detail: `${fmt(needles)} triângulos muito finos (comum em exportações CAD). O SmartCut reamostra a malha sozinho; o corte funciona normalmente.`,
      count: needles,
      options: [
        { value: 'warn', label: 'Só avisar' },
        { value: 'volumetric', label: 'Remesh volumétrico' },
      ],
      focus: boundsOf(markers.positions),
      markers,
    });
  }

  // Genus.
  const handles = facts.shells.reduce((s, sh) => s + sh.genus, 0);
  if (handles > 0) {
    issues.push({
      kind: 'genus',
      severity: 'info',
      title: `${handles} alça(s) na forma`,
      detail: 'A peça tem furos passantes ou partes que se tocam formando alças (ex.: braço encostado na cintura). O SmartCut fecha cada lado da alça separadamente.',
      count: handles,
      options: [],
    });
  }

  // Printer fit.
  if (opts.buildVolume && longest > 0) {
    const bv = [...opts.buildVolume].sort((a, b) => b - a);
    const sz = [...size].sort((a, b) => b - a);
    if (sz.some((s, i) => s > bv[i])) {
      issues.push({
        kind: 'fit',
        severity: 'info',
        title: 'Não cabe na impressora',
        detail: `${fmtMm(size[0], 0)} × ${fmtMm(size[1], 0)} × ${fmtMm(size[2], 0)} mm em uma mesa de ${opts.buildVolume.map((v) => fmtMm(v, 0)).join(' × ')} mm.`,
        count: 1,
        options: [
          { value: 'autosplit', label: 'Sugerir auto-split depois de importar' },
          { value: 'none', label: 'Não dividir' },
        ],
      });
    }
  }

  query?.dispose();
  const order = { critical: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  const grade = issues.some((i) => i.severity === 'critical') ? 'critical' : issues.some((i) => i.severity === 'warning' && i.options.length) ? 'repair' : 'ok';
  const closed = facts.boundaryEdges.length === 0 && facts.nonManifoldEdges.length === 0;
  return {
    id,
    name,
    grade,
    triangles: nf,
    vertices: p.length / 3,
    size,
    bounds,
    shells: facts.shells.length,
    volume: closed ? totalVolume : null,
    issues,
    ms: performance.now() - t0,
    preview: toDisplayMesh(mesh),
  };
}
