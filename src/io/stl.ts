import type { MeshData } from '../geometry/types';

const decoder = new TextDecoder();

function isAscii(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return true;
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  if (84 + triangles * 50 === buffer.byteLength) return false;
  const head = decoder.decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength))).trimStart();
  return head.startsWith('solid') && head.includes('facet');
}

/** Parses binary or ASCII STL into a triangle soup (9 floats per triangle). */
export function parseSTL(buffer: ArrayBuffer): Float32Array {
  if (isAscii(buffer)) {
    const text = decoder.decode(buffer);
    const out: number[] = [];
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    if (out.length === 0 || out.length % 9 !== 0) throw new Error('STL ASCII inválido.');
    return Float32Array.from(out);
  }
  const view = new DataView(buffer);
  const n = view.getUint32(80, true);
  if (84 + n * 50 > buffer.byteLength) throw new Error('STL binário truncado.');
  const out = new Float32Array(n * 9);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12; // facet normal (recomputed later)
    for (let k = 0; k < 9; k++) {
      out[t * 9 + k] = view.getFloat32(o, true);
      o += 4;
    }
    o += 2;
  }
  return out;
}

/** Binary STL (normals computed per facet). */
export function writeSTL(mesh: MeshData, name = 'mobios'): Uint8Array {
  const { positions: p, indices: t } = mesh;
  const n = t.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  const header = new TextEncoder().encode(`Mobios ${name}`.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(header);
  view.setUint32(80, n, true);
  let o = 84;
  for (let f = 0; f < n; f++) {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, p[v], true); view.setFloat32(o + 4, p[v + 1], true); view.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}
