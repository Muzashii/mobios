import type { MeshData } from '../../src/geometry/types';

/** Axis-aligned box as an indexed mesh (outward winding). */
export function boxMesh(size = 10, center: [number, number, number] = [0, 0, 0]): MeshData {
  const h = size / 2;
  const [cx, cy, cz] = center;
  const positions = new Float32Array([
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    -h, -h, h, h, -h, h, h, h, h, -h, h, h,
  ].map((v, i) => v + [cx, cy, cz][i % 3]));
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom
    4, 5, 6, 4, 6, 7, // top
    0, 1, 5, 0, 5, 4, // front
    1, 2, 6, 1, 6, 5, // right
    2, 3, 7, 2, 7, 6, // back
    3, 0, 4, 3, 4, 7, // left
  ]);
  return { positions, indices };
}

/** Expands an indexed mesh to an STL-like triangle soup. */
export function toSoup(mesh: MeshData): Float32Array {
  const out = new Float32Array(mesh.indices.length * 3);
  mesh.indices.forEach((v, i) => out.set(mesh.positions.subarray(v * 3, v * 3 + 3), i * 3));
  return out;
}

export function asciiSTL(mesh: MeshData): string {
  const soup = toSoup(mesh);
  const lines = ['solid test'];
  for (let i = 0; i < soup.length; i += 9) {
    lines.push('facet normal 0 0 0', ' outer loop');
    for (let k = 0; k < 3; k++) lines.push(`  vertex ${soup[i + k * 3]} ${soup[i + k * 3 + 1]} ${soup[i + k * 3 + 2]}`);
    lines.push(' endloop', 'endfacet');
  }
  lines.push('endsolid test');
  return lines.join('\n');
}
