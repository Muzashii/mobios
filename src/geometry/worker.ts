/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { GeometryService } from './service';
import type { CutOperation, InspectionReport, RepairPlan, Vec3, EvalResult, ExportFormat, ExportPart, ImportedMesh, MeshData, Operation, SourceRef, Technology } from './types';
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
  async smartCut(partId: string, seeds: Vec3[], seedRadius: number, beforeOp?: string) {
    return (await service).smartCut(partId, seeds, seedRadius, beforeOp);
  },
  async smartCutClusters(partId: string, seeds: Vec3[], seedRadius: number, negSeeds?: Vec3[], beforeOp?: string) {
    const res = (await service).smartCutClusters(partId, seeds, seedRadius, negSeeds, beforeOp);
    const buffers = res.flatMap((r) => ('suggestion' in r ? r.suggestion.candidates.map((c) => c.preview.buffer as ArrayBuffer) : []));
    return Comlink.transfer(res, buffers);
  },
  async smartHover(partId: string, point: Vec3, seedRadius: number) {
    const h = (await service).smartHover(partId, point, seedRadius);
    return h ? Comlink.transfer(h, [h.preview.buffer as ArrayBuffer]) : null;
  },
  async partMap(partId: string) {
    const r = (await service).partMap(partId);
    return Comlink.transfer(r, [r.labels.buffer as ArrayBuffer]);
  },
  async checkCut(op: CutOperation, beforeOp?: string) {
    const c = (await service).checkCut(op, beforeOp);
    return Comlink.transfer(c, c.previewB ? ([c.previewB.positions.buffer, c.previewB.normals.buffer] as ArrayBuffer[]) : []);
  },
  async inspectFile(fileName: string, buffer: ArrayBuffer, idPrefix: string, tech: Technology, buildVolume?: Vec3): Promise<InspectionReport[]> {
    const reports = (await service).inspectFile(fileName, buffer, idPrefix, tech, buildVolume);
    const buffers = reports.flatMap((r) => [r.preview.positions.buffer, r.preview.normals.buffer, ...r.issues.flatMap((i) => (i.markers ? [i.markers.positions.buffer] : []))]) as ArrayBuffer[];
    return Comlink.transfer(reports, buffers);
  },
  async finishImport(id: string, plan: RepairPlan) {
    const out = (await service).finishImport(id, plan);
    return Comlink.transfer(out, out.meshes.flatMap((m) => meshBuffers(m.mesh)));
  },
  async discardImport(id: string) {
    (await service).discardImport(id);
  },
  async analyze(partId: string, tech: Technology) {
    return (await service).analyze(partId, tech);
  },
  async orientation(partId: string, tech: Technology) {
    return (await service).orientation(partId, tech);
  },
  async autoSplit(partId: string, volume: Vec3, tech: Technology, margin?: number) {
    return (await service).autoSplit(partId, volume, tech, margin);
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
