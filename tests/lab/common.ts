import fs from 'node:fs';
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData, Vec3 } from '../../src/geometry/types';

export const LAB = process.env.MOBIOS_LAB_DIR ?? '.lab';
export const hasLab = fs.existsSync(`${LAB}/full.pos.bin`);

export function readMesh(name: string): MeshData {
  const p = fs.readFileSync(`${LAB}/${name}.pos.bin`);
  const i = fs.readFileSync(`${LAB}/${name}.idx.bin`);
  return {
    positions: new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)),
    indices: new Uint32Array(i.buffer.slice(i.byteOffset, i.byteOffset + i.byteLength)),
  };
}

export function writeMesh(name: string, m: MeshData) {
  fs.writeFileSync(`${LAB}/${name}.pos.bin`, Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength));
  fs.writeFileSync(`${LAB}/${name}.idx.bin`, Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength));
}

/** Triangle soup (9 floats per tri) → indexed mesh file the viewer can load. */
export function writeSoup(name: string, soup: Float32Array) {
  const idx = new Uint32Array(soup.length / 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  writeMesh(name, { positions: soup, indices: idx });
}

export function writeLabels(name: string, labels: Int32Array) {
  fs.writeFileSync(`${LAB}/${name}.lab.bin`, Buffer.from(labels.buffer, labels.byteOffset, labels.byteLength));
}

/** Ray-cast picker: point and face hit by a click ray (from, dir). */
export function picker(mesh: MeshData) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  const bvh = new MeshBVH(g, { indirect: true }); // keep face order: faceIndex = our face id
  return (from: Vec3, dir: Vec3): { point: Vec3; face: number } | null => {
    const hit = bvh.raycastFirst(new Ray(new Vector3(...from), new Vector3(...dir).normalize()), DoubleSide);
    return hit ? { point: hit.point.toArray() as Vec3, face: hit.faceIndex ?? -1 } : null;
  };
}

type Ray3 = [Vec3, Vec3];
const front = (x: number, z: number): Ray3 => [[x, -100, z], [0, 1, 0]];
const back = (x: number, z: number): Ray3 => [[x, 100, z], [0, -1, 0]];

/**
 * Expected parts of the test figure (Z up, facing −Y; its left side is +X). Each part: the click,
 * points that must come with it and points that must stay out. Stage 0 of
 * docs/PLANO-MULTIPARTES.md.
 */
export const FIGURE_PARTS: { name: string; click: Ray3; include: Ray3[]; exclude: Ray3[] }[] = [
  { name: 'Chapéu', click: [[0, 0, 120], [0, 0, -1]], include: [front(-29, 26), [[100, 0, 26], [-1, 0, 0]], back(0, 40)], exclude: [front(0, 8), back(0, 10)] },
  { name: 'Cabeça', click: front(0, 8), include: [back(0, 10), [[100, 0, 14], [-1, 0, 0]], [[-100, 0, 14], [1, 0, 0]]], exclude: [[[0, 0, 120], [0, 0, -1]], front(2, -12)] },
  { name: 'Tronco', click: front(2, -12), include: [back(0, -12)], exclude: [front(0, 8), front(-6, -37), front(-16.3, -15.2)] },
  { name: 'Braço direito', click: front(-16.3, -15.2), include: [back(-20, -21)], exclude: [front(2, -12), front(-18.5, -44)] },
  { name: 'Braço esquerdo', click: [[100, 0, -12], [-1, 0, 0]], include: [back(4.3, -25)], exclude: [front(2, -12), back(0, -12)] },
  { name: 'Perna direita', click: front(-6, -37), include: [front(-11, -47)], exclude: [front(9, -37), front(2, -12)] },
  { name: 'Perna esquerda', click: front(9, -37), include: [front(12, -47)], exclude: [front(-6, -37), front(2, -12)] },
  { name: 'Bengala', click: front(-18.5, -44), include: [], exclude: [front(-16.3, -15.2), front(-6, -37)] },
];
