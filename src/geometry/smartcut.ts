import type { MeshData, SmartCutSuggestion, Vec3 } from './types';

/**
 * SmartCut — suggests where to separate the region around the seed from the rest.
 *
 * 1. Geodesic distance (Dijkstra on the edge graph) from the seed region R.
 * 2. Iso-distance rings: at each level t the surface splits into the part near R
 *    and the rest. We follow the ring bounding the largest remaining component
 *    (the "body") while it still holds more than half of the area.
 * 3. Each ring is scored by perimeter (narrow necks win), concavity (cuts along
 *    creases — the "minima rule") and a slight preference for staying close to R.
 * 4. A plane is fitted to the best ring (PCA) and returned as a bounded cut,
 *    which the user can still edit before confirming.
 */
export function suggestSmartCut(mesh: MeshData, seeds: Vec3[], seedRadius: number, levels = 72): SmartCutSuggestion {
  const { positions: p, indices: t } = mesh;
  const nv = p.length / 3;
  const nf = t.length / 3;
  if (!seeds.length || nf === 0) throw new Error('Pincele ou clique na região que quer separar.');

  // --- Adjacency (CSR) and per-vertex area / normal.
  const deg = new Uint32Array(nv + 1);
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    deg[t[i + k] + 1] += 2;
  }
  for (let v = 0; v < nv; v++) deg[v + 1] += deg[v];
  const fill = deg.slice(0, nv);
  const nbr = new Uint32Array(deg[nv]);
  const area = new Float64Array(nv);
  const vn = new Float64Array(nv * 3);
  let totalArea = 0;
  for (let f = 0; f < nf; f++) {
    const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2];
    nbr[fill[a]++] = b; nbr[fill[a]++] = c;
    nbr[fill[b]++] = c; nbr[fill[b]++] = a;
    nbr[fill[c]++] = a; nbr[fill[c]++] = b;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    const ar = Math.hypot(cx, cy, cz) / 2;
    totalArea += ar;
    for (const v of [a, b, c]) {
      area[v] += ar / 3;
      vn[v * 3] += cx; vn[v * 3 + 1] += cy; vn[v * 3 + 2] += cz;
    }
  }
  const dist = (a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);

  // Concavity: neighbours above the tangent plane → concave (positive).
  const concav = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]) || 1;
    let s = 0, n = 0;
    for (let k = deg[v]; k < deg[v + 1]; k++) {
      const w = nbr[k];
      const d = dist(v, w) || 1;
      s += ((p[w * 3] - p[v * 3]) * vn[v * 3] + (p[w * 3 + 1] - p[v * 3 + 1]) * vn[v * 3 + 1] + (p[w * 3 + 2] - p[v * 3 + 2]) * vn[v * 3 + 2]) / (l * d);
      n++;
    }
    concav[v] = n ? Math.max(0, s / n) : 0;
  }
  // Absolute scale: ~0.25 is a clear crease (≈ 30° fold); below 0.02 is tessellation noise.
  const creaseness = (c: number) => Math.min(2, Math.max(0, c - 0.02) / 0.25);

  // --- Seed region R. A brush dab only touches the visible side of a limb; the Shape
  // Diameter Function (median inward ray length) turns it into the ball inscribed in the
  // limb at that spot, so R wraps all the way around it.
  const balls = shapeDiameterBalls(p, t, vn, seeds, seedRadius);
  const inR = new Uint8Array(nv);
  let rCount = 0;
  const rCentroid: Vec3 = [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    for (const b of balls) {
      if (Math.hypot(p[v * 3] - b.c[0], p[v * 3 + 1] - b.c[1], p[v * 3 + 2] - b.c[2]) <= b.r) {
        inR[v] = 1;
        break;
      }
    }
  }
  if (!inR.some(Boolean)) {
    for (const s of seeds) {
      let best = 0, bd = Infinity;
      for (let v = 0; v < nv; v++) {
        const d = Math.hypot(p[v * 3] - s[0], p[v * 3 + 1] - s[1], p[v * 3 + 2] - s[2]);
        if (d < bd) { bd = d; best = v; }
      }
      inR[best] = 1;
    }
  }
  for (let v = 0; v < nv; v++) if (inR[v]) {
    rCount++;
    rCentroid[0] += p[v * 3]; rCentroid[1] += p[v * 3 + 1]; rCentroid[2] += p[v * 3 + 2];
  }
  rCentroid[0] /= rCount; rCentroid[1] /= rCount; rCentroid[2] /= rCount;

  // --- Multi-source Dijkstra (binary heap).
  const d = new Float64Array(nv).fill(Infinity);
  const heap: number[] = [];
  const hd: number[] = [];
  const push = (v: number, key: number) => {
    heap.push(v); hd.push(key);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hd[parent] <= hd[i]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      [hd[parent], hd[i]] = [hd[i], hd[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const v = heap[0], key = hd[0];
    const lv = heap.pop()!, lk = hd.pop()!;
    if (heap.length) {
      heap[0] = lv; hd[0] = lk;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hd[l] < hd[m]) m = l;
        if (r < heap.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [hd[m], hd[i]] = [hd[i], hd[m]];
        i = m;
      }
    }
    return [v, key] as const;
  };
  for (let v = 0; v < nv; v++) if (inR[v]) { d[v] = 0; push(v, 0); }
  while (heap.length) {
    const [v, key] = pop();
    if (key > d[v]) continue;
    for (let k = deg[v]; k < deg[v + 1]; k++) {
      const w = nbr[k];
      const nd = key + dist(v, w);
      if (nd < d[w]) { d[w] = nd; push(w, nd); }
    }
  }
  let maxD = 0;
  for (let v = 0; v < nv; v++) if (Number.isFinite(d[v]) && d[v] > maxD) maxD = d[v];
  if (maxD <= 0) throw new Error('A região pincelada cobre a peça inteira.');

  // --- Superlevel components via union-find, swept from far to near.
  const order = Array.from({ length: nv }, (_, i) => i).filter((v) => Number.isFinite(d[v])).sort((a, b) => d[b] - d[a]);
  const parent = new Int32Array(nv).fill(-1);
  const compArea = new Float64Array(nv);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const levelT: number[] = [];
  for (let k = levels - 1; k >= 1; k--) levelT.push((maxD * k) / levels);

  interface Level { t: number; perimeter: number; concavity: number; bigRoot: number; valid: boolean }
  const results: Level[] = [];
  let oi = 0;
  let bigRoot = -1;
  for (const lt of levelT) {
    while (oi < order.length && d[order[oi]] >= lt) {
      const v = order[oi++];
      parent[v] = v;
      compArea[v] = area[v];
      for (let k = deg[v]; k < deg[v + 1]; k++) {
        const w = nbr[k];
        if (parent[w] === -1) continue;
        const rv = find(v), rw = find(w);
        if (rv !== rw) {
          parent[rw] = rv;
          compArea[rv] += compArea[rw];
        }
      }
    }
    // Largest component at this level.
    let bestArea = 0;
    bigRoot = -1;
    for (let i = 0; i < oi; i++) {
      const r = find(order[i]);
      if (compArea[r] > bestArea) { bestArea = compArea[r]; bigRoot = r; }
    }
    const valid = bigRoot >= 0 && bestArea > totalArea * 0.5;
    let perimeter = 0, conc = 0;
    if (valid) {
      forEachRingSegment(lt, bigRoot, (x0, x1, c0, c1) => {
        const len = Math.hypot(x1[0] - x0[0], x1[1] - x0[1], x1[2] - x0[2]);
        perimeter += len;
        conc += ((c0 + c1) / 2) * len;
      });
    }
    results.push({ t: lt, perimeter, concavity: perimeter ? creaseness(conc / perimeter) : 0, bigRoot, valid });
  }

  function forEachRingSegment(lt: number, root: number, cb: (a: Vec3, b: Vec3, ca: number, cb: number) => void) {
    for (let f = 0; f < nf; f++) {
      const vs = [t[f * 3], t[f * 3 + 1], t[f * 3 + 2]];
      const up = vs.map((v) => d[v] >= lt);
      const nUp = up.filter(Boolean).length;
      if (nUp === 0 || nUp === 3) continue;
      const upV = vs[up.indexOf(true)];
      if (parent[upV] === -1 || find(upV) !== root) continue;
      const pts: Vec3[] = [];
      const cs: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = vs[k], b = vs[(k + 1) % 3];
        if (up[k] === up[(k + 1) % 3]) continue;
        const s = (lt - d[a]) / (d[b] - d[a]);
        pts.push([
          p[a * 3] + (p[b * 3] - p[a * 3]) * s,
          p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * s,
          p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * s,
        ]);
        cs.push(concav[a] + (concav[b] - concav[a]) * s);
      }
      if (pts.length === 2) cb(pts[0], pts[1], cs[0], cs[1]);
    }
  }

  // Results are far → near; score near → far.
  const valid = results.filter((r) => r.valid && r.perimeter > 0).reverse();
  if (valid.length === 0) throw new Error('Não encontrei uma articulação. Pincele a região que quer separar (ex.: o braço inteiro).');
  const sortedL = valid.map((r) => r.perimeter).sort((a, b) => a - b);
  const lMed = sortedL[Math.floor(sortedL.length / 2)];
  const tMax = valid[valid.length - 1].t;
  // Around a click or a one-sided brush stroke the rings first grow like a disc
  // (≈ 2π mm of perimeter per mm of distance) before they wrap around the limb.
  // Those rings run along the limb, not across it: skip them. Candidates start where
  // the perimeter stops growing fast (ring wrapped around / passed a tip) or at a crease.
  let start = valid.length - 1;
  for (let i = 0; i < valid.length; i++) {
    if (valid[i].concavity >= 0.35) { start = i; break; }
    const next = valid[i + 1];
    if (next && (next.perimeter - valid[i].perimeter) / (next.t - valid[i].t) < 1) { start = i; break; }
  }
  let best = valid[start], bestScore = Infinity;
  for (const r of valid.slice(start)) {
    const score = r.perimeter / lMed - 0.6 * Math.min(1.5, r.concavity) + 0.3 * (r.t / tMax);
    if (score < bestScore) { bestScore = score; best = r; }
  }

  // --- Re-run the union-find up to the chosen level to recover its ring.
  parent.fill(-1);
  oi = 0;
  for (const lt of levelT) {
    while (oi < order.length && d[order[oi]] >= lt) {
      const v = order[oi++];
      parent[v] = v;
      compArea[v] = area[v];
      for (let k = deg[v]; k < deg[v + 1]; k++) {
        const w = nbr[k];
        if (parent[w] === -1) continue;
        const rv = find(v), rw = find(w);
        if (rv !== rw) { parent[rw] = rv; compArea[rv] += compArea[rw]; }
      }
    }
    if (lt === best.t) break;
  }
  let root = -1, rootArea = 0;
  for (let i = 0; i < oi; i++) {
    const r = find(order[i]);
    if (compArea[r] > rootArea) { rootArea = compArea[r]; root = r; }
  }
  const ring: Vec3[] = [];
  forEachRingSegment(best.t, root, (a, b) => ring.push(a, b));

  // --- Plane fit (PCA): normal = direction of least spread.
  const c: Vec3 = [0, 0, 0];
  for (const q of ring) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; }
  c[0] /= ring.length; c[1] /= ring.length; c[2] /= ring.length;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const q of ring) {
    const x = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += x[i] * x[j];
  }
  let normal = smallestEigenvector(cov);
  // Normal points towards the seed side: that side becomes part B.
  const toSeed = [rCentroid[0] - c[0], rCentroid[1] - c[1], rCentroid[2] - c[2]];
  if (normal[0] * toSeed[0] + normal[1] * toSeed[1] + normal[2] * toSeed[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];
  let radius = 0;
  for (const q of ring) radius = Math.max(radius, Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]));
  // Step slightly onto the limb: a plane exactly on the crease can graze the body.
  const step = Math.min(radius * 0.15, 2);
  const origin: Vec3 = [c[0] + normal[0] * step, c[1] + normal[1] * step, c[2] + normal[2] * step];

  // Confidence: how much narrower/creased this ring is than a typical one.
  const confidence = Math.max(0, Math.min(1, 1 - bestScore / 1.15));
  return {
    plane: { origin, normal },
    radius: radius * 1.35 + 1,
    ring: ring.filter((_, i) => i % 2 === 0),
    perimeter: best.perimeter,
    confidence,
  };
}

/** Sorted distances of every triangle crossing along a ray (Möller–Trumbore). */
function rayHits(p: Float32Array, t: Uint32Array, o: Vec3, d: Vec3): number[] {
  const hits: number[] = [];
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = o[0] - p[a], sy = o[1] - p[a + 1], sz = o[2] - p[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-6) hits.push(dist);
  }
  return hits.sort((x, y) => x - y);
}

/**
 * Shape Diameter Function per seed: median length of a cone of rays shot inwards
 * (against the surface normal). Each seed becomes the ball inscribed in the part there.
 */
export function shapeDiameterBalls(p: Float32Array, t: Uint32Array, vn: Float64Array, seeds: Vec3[], brushRadius: number) {
  const nv = p.length / 3;
  // Ray casting is brute force: sample at most 16 seeds, others reuse the nearest sample.
  const step = Math.max(1, Math.ceil(seeds.length / 16));
  const samples: { s: Vec3; c: Vec3; r: number }[] = [];
  for (let i = 0; i < seeds.length; i += step) {
    const s = seeds[i];
    let nearest = 0, nd = Infinity;
    for (let v = 0; v < nv; v++) {
      const d = Math.hypot(p[v * 3] - s[0], p[v * 3 + 1] - s[1], p[v * 3 + 2] - s[2]);
      if (d < nd) { nd = d; nearest = v; }
    }
    const l = Math.hypot(vn[nearest * 3], vn[nearest * 3 + 1], vn[nearest * 3 + 2]) || 1;
    const n: Vec3 = [vn[nearest * 3] / l, vn[nearest * 3 + 1] / l, vn[nearest * 3 + 2] / l];
    const inward: Vec3 = [-n[0], -n[1], -n[2]];
    const helper: Vec3 = Math.abs(inward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const a = normalize3([inward[1] * helper[2] - inward[2] * helper[1], inward[2] * helper[0] - inward[0] * helper[2], inward[0] * helper[1] - inward[1] * helper[0]]);
    const b = normalize3([inward[1] * a[2] - inward[2] * a[1], inward[2] * a[0] - inward[0] * a[2], inward[0] * a[1] - inward[1] * a[0]]);
    // Start 1 mm outside: the 1st crossing is the entry, the 2nd the exit (thickness).
    const origin: Vec3 = [s[0] + n[0], s[1] + n[1], s[2] + n[2]];
    const lengths: number[] = [];
    const cone = Math.tan((25 * Math.PI) / 180);
    const dirs: Vec3[] = [inward];
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      dirs.push(normalize3([
        inward[0] + cone * (Math.cos(ang) * a[0] + Math.sin(ang) * b[0]),
        inward[1] + cone * (Math.cos(ang) * a[1] + Math.sin(ang) * b[1]),
        inward[2] + cone * (Math.cos(ang) * a[2] + Math.sin(ang) * b[2]),
      ]));
    }
    let axisEntry = 1;
    for (const d of dirs) {
      const hits = rayHits(p, t, origin, d);
      if (hits.length < 2) continue;
      if (d === inward) axisEntry = hits[0];
      lengths.push((hits[1] - hits[0]) * (d === inward ? 1 : Math.cos((25 * Math.PI) / 180)));
    }
    lengths.sort((x, y) => x - y);
    const diameter = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
    if (diameter <= 0) {
      samples.push({ s, c: s, r: brushRadius });
      continue;
    }
    // Centre on the medial axis under the dab; inflate so the ball reaches the far wall.
    const depth = axisEntry - 1 + diameter / 2;
    samples.push({ s, c: [s[0] - n[0] * depth, s[1] - n[1] * depth, s[2] - n[2] * depth], r: Math.max(brushRadius, (diameter / 2) * 1.35) });
  }
  // Every seed keeps its own dab, plus the inscribed ball of its nearest sample.
  const balls = seeds.map((s) => ({ c: s, r: brushRadius }));
  for (const sm of samples) balls.push({ c: sm.c, r: sm.r });
  return balls;
}

const normalize3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Eigenvector of the smallest eigenvalue of a symmetric 3×3 matrix (Jacobi). */
export function smallestEigenvector(m: number[]): Vec3 {
  const a = [...m];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) off += a[i * 3 + j] ** 2;
    if (off < 1e-18) break;
    for (const [pI, qI] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[pI * 3 + qI];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[qI * 3 + qI] - a[pI * 3 + pI]) / (2 * apq);
      const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(tt * tt + 1), sn = tt * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + pI], akq = a[k * 3 + qI];
        a[k * 3 + pI] = cs * akp - sn * akq;
        a[k * 3 + qI] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[pI * 3 + k], aqk = a[qI * 3 + k];
        a[pI * 3 + k] = cs * apk - sn * aqk;
        a[qI * 3 + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + pI], vkq = v[k * 3 + qI];
        v[k * 3 + pI] = cs * vkp - sn * vkq;
        v[k * 3 + qI] = sn * vkp + cs * vkq;
      }
    }
  }
  let idx = 0;
  for (let i = 1; i < 3; i++) if (a[i * 4] < a[idx * 4]) idx = i;
  const e: Vec3 = [v[idx], v[3 + idx], v[6 + idx]];
  const l = Math.hypot(...e) || 1;
  return [e[0] / l, e[1] / l, e[2] / l];
}
