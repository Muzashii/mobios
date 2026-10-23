import type { MeshData } from '../geometry/types';

export interface NamedMesh {
  name: string;
  mesh: MeshData;
}

/** Parses Wavefront OBJ (positions + faces; polygons are fan-triangulated). One mesh per `o`/`g`. */
export function parseOBJ(text: string, fallbackName = 'OBJ'): NamedMesh[] {
  const verts: number[] = [];
  const groups: { name: string; tris: number[] }[] = [{ name: fallbackName, tris: [] }];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    switch (parts[0]) {
      case 'v':
        verts.push(+parts[1], +parts[2], +parts[3]);
        break;
      case 'o':
      case 'g': {
        const name = parts.slice(1).join(' ') || fallbackName;
        const cur = groups[groups.length - 1];
        if (cur.tris.length === 0) cur.name = name;
        else groups.push({ name, tris: [] });
        break;
      }
      case 'f': {
        const count = verts.length / 3;
        const idx = parts.slice(1).map((tok) => {
          const i = parseInt(tok.split('/')[0], 10);
          return i < 0 ? count + i : i - 1;
        });
        const cur = groups[groups.length - 1];
        for (let k = 1; k + 1 < idx.length; k++) cur.tris.push(idx[0], idx[k], idx[k + 1]);
        break;
      }
    }
  }
  const positions = Float32Array.from(verts);
  return groups
    .filter((g) => g.tris.length)
    .map((g) => ({ name: g.name, mesh: { positions, indices: Uint32Array.from(g.tris) } }));
}

export function writeOBJ(mesh: MeshData, name: string): string {
  const { positions: p, indices: t } = mesh;
  const out: string[] = [`# Fenda Studio`, `o ${name}`];
  for (let i = 0; i < p.length; i += 3) out.push(`v ${+p[i].toFixed(5)} ${+p[i + 1].toFixed(5)} ${+p[i + 2].toFixed(5)}`);
  for (let i = 0; i < t.length; i += 3) out.push(`f ${t[i] + 1} ${t[i + 1] + 1} ${t[i + 2] + 1}`);
  return out.join('\n') + '\n';
}
