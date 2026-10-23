import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { MeshData } from '../geometry/types';
import { parseOBJ, type NamedMesh } from './obj';
import { parseSTL } from './stl';
import { parse3MF } from './threemf';

export const IMPORT_EXTENSIONS = ['.stl', '.obj', '.3mf'] as const;

const baseName = (file: string) => file.replace(/\.[^.]+$/, '');

export interface RawMesh {
  name: string;
  positions: Float32Array;
  /** Missing for triangle soups (STL). */
  indices?: Uint32Array;
}

/** Decodes a model file into raw meshes (no repair yet). Runs fine inside a worker. */
export function decodeModel(fileName: string, buffer: ArrayBuffer): RawMesh[] {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  const name = baseName(fileName);
  switch (ext) {
    case '.stl':
      return [{ name, positions: parseSTL(buffer) }];
    case '.obj':
      return parseOBJ(new TextDecoder().decode(buffer), name).map((m) => ({ name: m.name, ...m.mesh }));
    case '.3mf':
      return parse3MF(new Uint8Array(buffer), name).map((m: NamedMesh) => ({ name: m.name, ...m.mesh }));
    default:
      throw new Error(`Formato não suportado: ${ext || fileName}. Use STL, OBJ ou 3MF.`);
  }
}

export function zipFiles(files: Record<string, Uint8Array | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(entries, { level: 6 });
}

/** Serialized `.fenda` project: project.json + one binary per source mesh. */
export function packProject(doc: unknown, meshes: Record<string, MeshData>): Uint8Array {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(doc, null, 2)) };
  for (const [id, m] of Object.entries(meshes)) {
    const header = new Uint32Array([m.positions.length, m.indices.length]);
    const out = new Uint8Array(8 + m.positions.byteLength + m.indices.byteLength);
    out.set(new Uint8Array(header.buffer), 0);
    out.set(new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength), 8);
    out.set(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), 8 + m.positions.byteLength);
    files[`meshes/${id}.bin`] = out;
  }
  return zipSync(files, { level: 6 });
}

export function unpackProject<T>(data: Uint8Array): { doc: T; meshes: Record<string, MeshData> } {
  const files = unzipSync(data);
  const json = files['project.json'];
  if (!json) throw new Error('Arquivo .fenda inválido (sem project.json).');
  const meshes: Record<string, MeshData> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const m = /^meshes\/(.+)\.bin$/.exec(name);
    if (!m) continue;
    const copy = bytes.slice();
    const [pl, il] = new Uint32Array(copy.buffer, 0, 2);
    meshes[m[1]] = {
      positions: new Float32Array(copy.buffer, 8, pl),
      indices: new Uint32Array(copy.buffer, 8 + pl * 4, il),
    };
  }
  return { doc: JSON.parse(strFromU8(json)) as T, meshes };
}
