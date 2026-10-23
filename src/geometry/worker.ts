/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { GeometryService } from './service';
import type { EvalResult, ExportFormat, ExportPart, ImportedMesh, MeshData, Operation, SourceRef, Technology } from './types';
import { loadManifold } from './wasm';

const service = loadManifold(wasmUrl).then((wasm) => new GeometryService(wasm));

const meshBuffers = (m: MeshData) => [m.positions.buffer, m.indices.buffer] as ArrayBuffer[];
const imported = (list: ImportedMesh[]) => Comlink.transfer(list, list.flatMap((i) => meshBuffers(i.mesh)));

/** Worker API (all geometry runs here; buffers are transferred, not copied). */
const api = {
  async ping() {
    return (await service).ping();
  },
  async importFile(fileName: string, buffer: ArrayBuffer, idPrefix: string) {
    return imported((await service).importFile(fileName, buffer, idPrefix));
  },
  async registerSource(id: string, mesh: MeshData) {
    (await service).registerSource(id, mesh);
  },
  async hasSource(id: string) {
    return (await service).hasSource(id);
  },
  async evaluate(sources: SourceRef[], ops: Operation[], full = false): Promise<EvalResult> {
    const result = (await service).evaluate(sources, ops, full);
    const buffers = result.parts.flatMap((p) => (p.mesh ? [p.mesh.positions.buffer, p.mesh.normals.buffer] : [])) as ArrayBuffer[];
    return Comlink.transfer(result, buffers);
  },
  async partDisplayBefore(opId: string, partId: string) {
    const mesh = (await service).partDisplayBefore(opId, partId);
    return mesh ? Comlink.transfer(mesh, [mesh.positions.buffer, mesh.normals.buffer] as ArrayBuffer[]) : null;
  },
  async example(id: string) {
    return imported([(await service).example(id)])[0];
  },
  async calibration(idPrefix: string, tech: Technology) {
    return imported((await service).calibration(idPrefix, tech));
  },
  async exportParts(format: ExportFormat, parts: ExportPart[]) {
    const data = (await service).exportParts(format, parts);
    return Comlink.transfer(data, [data.buffer as ArrayBuffer]);
  },
};

export type GeometryApi = typeof api;

Comlink.expose(api);
