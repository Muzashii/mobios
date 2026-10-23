import { decodeModel, zipFiles } from '../io';
import { writeOBJ } from '../io/obj';
import { writeSTL } from '../io/stl';
import { write3MF } from '../io/threemf';
import { calibrationPieces, exampleFigure } from './primitives';
import { toDisplayMesh } from './display';
import { Engine } from './engine';
import { manifoldToMeshData, meshDataToManifold, repairMesh } from './repair';
import type { DisplayMesh, EvalResult, ExportFormat, ExportPart, ImportedMesh, MeshData, Operation, SourceRef, Technology } from './types';
import type { Wasm } from './wasm';

const safeFile = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'parte';

/** Everything the UI can ask the geometry worker. Also used directly by tests. */
export class GeometryService {
  readonly engine: Engine;

  constructor(private wasm: Wasm) {
    this.engine = new Engine(wasm);
  }

  ping() {
    return 'pong';
  }

  /** Decodes + repairs a file and registers each mesh as a source with ids `${idPrefix}-${n}`. */
  importFile(fileName: string, buffer: ArrayBuffer, idPrefix: string): ImportedMesh[] {
    const raws = decodeModel(fileName, buffer);
    return raws.map((raw, i) => {
      const { manifold, report } = repairMesh(this.wasm, raw.positions, raw.indices);
      const id = raws.length === 1 ? idPrefix : `${idPrefix}-${i + 1}`;
      this.engine.addSource(id, manifold);
      return { id, name: raw.name, mesh: manifoldToMeshData(manifold), report };
    });
  }

  /** Registers an already-valid mesh (restored from storage). */
  registerSource(id: string, mesh: MeshData) {
    this.engine.addSource(id, meshDataToManifold(this.wasm, mesh));
  }

  hasSource(id: string) {
    return this.engine.hasSource(id);
  }

  evaluate(sources: SourceRef[], ops: Operation[], full = false): EvalResult {
    return this.engine.evaluate(sources, ops, full);
  }

  /** Render mesh of a part right before `opId` (preview while editing an old cut). */
  partDisplayBefore(opId: string, partId: string): DisplayMesh | null {
    const m = this.engine.part(partId, opId);
    return m ? toDisplayMesh(manifoldToMeshData(m)) : null;
  }

  example(id: string): ImportedMesh {
    const m = exampleFigure(this.wasm);
    this.engine.addSource(id, m);
    return { id, name: 'Figura de exemplo', mesh: manifoldToMeshData(m), report: [] };
  }

  calibration(idPrefix: string, tech: Technology): ImportedMesh[] {
    const { holes, pins } = calibrationPieces(this.wasm, tech);
    this.engine.addSource(`${idPrefix}-furos`, holes);
    this.engine.addSource(`${idPrefix}-pinos`, pins);
    return [
      { id: `${idPrefix}-furos`, name: `Calibração ${tech} — furos`, mesh: manifoldToMeshData(holes), report: [] },
      { id: `${idPrefix}-pinos`, name: `Calibração ${tech} — pinos`, mesh: manifoldToMeshData(pins), report: [] },
    ];
  }

  exportParts(format: ExportFormat, parts: ExportPart[]): Uint8Array {
    const meshes = parts.map((p) => {
      const m = this.engine.part(p.id);
      if (!m) throw new Error(`Parte não encontrada: ${p.name}`);
      return { ...p, mesh: manifoldToMeshData(m) };
    });
    const numbered = (i: number, name: string) => `${String(i + 1).padStart(2, '0')}_${safeFile(name)}`;
    switch (format) {
      case 'stl-zip':
        return zipFiles(Object.fromEntries(meshes.map((p, i) => [`${numbered(i, p.name)}.stl`, writeSTL(p.mesh, p.name)])));
      case 'obj-zip':
        return zipFiles(Object.fromEntries(meshes.map((p, i) => [`${numbered(i, p.name)}.obj`, writeOBJ(p.mesh, p.name)])));
      case '3mf':
        return write3MF(meshes.map((p) => ({ name: p.name, mesh: p.mesh, color: p.color, slot: p.slot })));
    }
  }
}
