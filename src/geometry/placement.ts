import type { Vec2 } from './types';

export interface Raster {
  width: number;
  height: number;
  cell: number;
  originX: number;
  originY: number;
  /** Distance (mm) from each cell centre to the nearest outside cell; 0 outside. */
  dist: Float32Array;
}

/** Rasterizes polygons (even-odd, so holes work) and computes an exact Euclidean distance transform. */
export function distanceField(polygons: Vec2[][], maxCells = 160): Raster {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const cell = span / maxCells;
  const originX = minX - cell, originY = minY - cell;
  const width = Math.ceil((maxX - minX) / cell) + 3;
  const height = Math.ceil((maxY - minY) / cell) + 3;
  const inside = new Uint8Array(width * height);

  const xs: number[] = [];
  for (let j = 0; j < height; j++) {
    const y = originY + (j + 0.5) * cell;
    xs.length = 0;
    for (const poly of polygons) {
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
        const [x1, y1] = poly[k], [x2, y2] = poly[i];
        if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - originX) / cell - 0.5));
      const i1 = Math.min(width - 1, Math.floor((xs[s + 1] - originX) / cell - 0.5));
      for (let i = i0; i <= i1; i++) inside[j * width + i] = 1;
    }
  }

  // Felzenszwalb & Huttenlocher squared EDT, distance to nearest outside cell.
  const INF = 1e20;
  const f = new Float64Array(width * height);
  for (let i = 0; i < f.length; i++) f[i] = inside[i] ? INF : 0;
  const edt1d = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    const v = new Int32Array(n), z = new Float64Array(n + 1), d = new Float64Array(n), src = new Float64Array(n);
    for (let i = 0; i < n; i++) src[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((src[q] + q * q) - (src[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((src[q] + q * q) - (src[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + src[v[k]];
    }
    for (let i = 0; i < n; i++) set(i, d[i]);
  };
  for (let x = 0; x < width; x++) edt1d((i) => f[i * width + x], (i, val) => { f[i * width + x] = val; }, height);
  for (let y = 0; y < height; y++) edt1d((i) => f[y * width + i], (i, val) => { f[y * width + i] = val; }, width);

  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = inside[i] ? Math.max(0, Math.sqrt(f[i]) * cell - cell * 0.5) : 0;
  return { width, height, cell, originX, originY, dist };
}

/** Principal-axis extent of the inside region, used to decide how many pins fit naturally. */
function shapeAxes(r: Raster) {
  let n = 0, mx = 0, my = 0;
  for (let j = 0; j < r.height; j++) for (let i = 0; i < r.width; i++) {
    if (r.dist[j * r.width + i] > 0) { n++; mx += i; my += j; }
  }
  if (!n) return { major: 0, minor: 0, area: 0 };
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let j = 0; j < r.height; j++) for (let i = 0; i < r.width; i++) {
    if (r.dist[j * r.width + i] > 0) {
      const dx = i - mx, dy = j - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
  }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  // Uniform rectangle: variance = L^2 / 12.
  return { major: Math.sqrt(12 * l1) * r.cell, minor: Math.sqrt(12 * Math.max(l2, 0)) * r.cell, area: n * r.cell * r.cell };
}

export interface PlacementOptions {
  /** Required clearance radius around each centre (hole radius + min wall). */
  keepout: number;
  count: number | 'auto';
}

/**
 * Pole-of-inaccessibility placement: picks centres at maxima of the distance field,
 * spreading multiple pins along the face. Returns [] when nothing fits.
 */
export function placeConnectors(polygons: Vec2[][], opts: PlacementOptions): Vec2[] {
  if (!polygons.some((p) => p.length >= 3)) return [];
  const r = distanceField(polygons);
  const { major, minor } = shapeAxes(r);
  let count: number;
  if (opts.count === 'auto') {
    const aspect = minor > 0 ? major / minor : 1;
    count = aspect > 3.2 ? 3 : aspect > 1.8 ? 2 : 1;
    if (major < opts.keepout * 5) count = 1;
  } else {
    count = Math.max(1, Math.min(8, Math.round(opts.count)));
  }
  const separation = Math.max(opts.keepout * 2.2, major / (count + 0.5));

  const chosen: Vec2[] = [];
  for (let k = 0; k < count; k++) {
    let best = -1, bestScore = -Infinity;
    for (let idx = 0; idx < r.dist.length; idx++) {
      const d = r.dist[idx];
      if (d < opts.keepout) continue;
      const x = r.originX + ((idx % r.width) + 0.5) * r.cell;
      const y = r.originY + (Math.floor(idx / r.width) + 0.5) * r.cell;
      let nearest = Infinity;
      for (const [cx, cy] of chosen) nearest = Math.min(nearest, Math.hypot(x - cx, y - cy));
      if (nearest < separation) continue;
      // First pin: deepest point. Next pins: far from the others, still well inside.
      const score = chosen.length === 0 ? d : d * 2 + Math.min(nearest, separation * 1.5) * 0.1;
      if (score > bestScore) { bestScore = score; best = idx; }
    }
    if (best < 0) break;
    chosen.push([
      r.originX + ((best % r.width) + 0.5) * r.cell,
      r.originY + (Math.floor(best / r.width) + 0.5) * r.cell,
    ]);
  }
  return chosen;
}
