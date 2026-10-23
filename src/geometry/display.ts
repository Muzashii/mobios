import type { DisplayMesh, MeshData } from './types';

/**
 * Expands an indexed mesh into a render mesh with creased normals:
 * smooth across soft edges, sharp across edges steeper than `creaseDeg`.
 */
export function toDisplayMesh(mesh: MeshData, creaseDeg = 35): DisplayMesh {
  const { positions: p, indices: t } = mesh;
  const triCount = t.length / 3;
  const vertCount = p.length / 3;
  const fn = new Float32Array(triCount * 3);
  for (let f = 0; f < triCount; f++) {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    // Area-weighted normal.
    fn[f * 3] = uy * vz - uz * vy;
    fn[f * 3 + 1] = uz * vx - ux * vz;
    fn[f * 3 + 2] = ux * vy - uy * vx;
  }

  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  for (let i = 0; i < t.length; i++) {
    const v = t[i] * 3;
    positions[i * 3] = p[v]; positions[i * 3 + 1] = p[v + 1]; positions[i * 3 + 2] = p[v + 2];
  }

  // Large meshes: flat shading keeps this fast and memory-light.
  if (triCount > 1_500_000) {
    for (let f = 0; f < triCount; f++) {
      const l = Math.hypot(fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) {
        normals[f * 9 + k * 3] = fn[f * 3] / l;
        normals[f * 9 + k * 3 + 1] = fn[f * 3 + 1] / l;
        normals[f * 9 + k * 3 + 2] = fn[f * 3 + 2] / l;
      }
    }
    return { positions, normals };
  }

  // Vertex -> incident faces (CSR).
  const start = new Uint32Array(vertCount + 1);
  for (let i = 0; i < t.length; i++) start[t[i] + 1]++;
  for (let v = 0; v < vertCount; v++) start[v + 1] += start[v];
  const fill = start.slice(0, vertCount);
  const faces = new Uint32Array(t.length);
  for (let i = 0; i < t.length; i++) faces[fill[t[i]]++] = (i / 3) | 0;

  const unit = new Float32Array(triCount * 3);
  for (let f = 0; f < triCount; f++) {
    const l = Math.hypot(fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]) || 1;
    unit[f * 3] = fn[f * 3] / l; unit[f * 3 + 1] = fn[f * 3 + 1] / l; unit[f * 3 + 2] = fn[f * 3 + 2] / l;
  }
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  for (let i = 0; i < t.length; i++) {
    const f = (i / 3) | 0, v = t[i];
    let nx = 0, ny = 0, nz = 0;
    for (let k = start[v]; k < start[v + 1]; k++) {
      const g = faces[k];
      if (unit[f * 3] * unit[g * 3] + unit[f * 3 + 1] * unit[g * 3 + 1] + unit[f * 3 + 2] * unit[g * 3 + 2] >= cos) {
        nx += fn[g * 3]; ny += fn[g * 3 + 1]; nz += fn[g * 3 + 2];
      }
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / l; normals[i * 3 + 1] = ny / l; normals[i * 3 + 2] = nz / l;
  }
  return { positions, normals };
}
