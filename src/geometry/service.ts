import type { Manifold } from 'manifold-3d';
import { decodeModel, zipFiles } from '../io';
import { writeOBJ } from '../io/obj';
import { writeSTL } from '../io/stl';
import { write3MF } from '../io/threemf';
import { calibrationPieces, exampleFigure } from './primitives';
import { suggestSmartCut } from './smartcut';
import { planAutoSplit, type AutoSplitPlan } from './autosplit';
import { analyzePrintability, suggestOrientation, type OrientationSuggestion } from './printability';
import { toDisplayMesh } from './display';
import { Engine } from './engine';
import { manifoldToMeshData, meshDataToManifold, repairMesh } from './repair';
import type { DisplayMesh, SmartCutSuggestion, Vec3, EvalResult, ExportFormat, ExportPart, ImportedMesh, MeshData, Operation, SourceRef, Technology } from './types';
import type { Wasm } from './wasm';

/** Rotates a mesh so `down` points to −Z and rests it on z = 0 (print orientation). */
export function orientDown(mesh: MeshData, down: Vec3): MeshData {
  const l = Math.hypot(...down) || 1;
  const d: Vec3 = [down[0] / l, down[1] / l, down[2] / l];
  // Rodrigues rotation taking d onto (0, 0, −1).
  const t: Vec3 = [0, 0, -1];
  const c = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
  const k: Vec3 = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
  const s = Math.hypot(...k);
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  let minZ = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i], y = p[i + 1], z = p[i + 2];
    if (s > 1e-9) {
      const u: Vec3 = [k[0] / s, k[1] / s, k[2] / s];
      const dot = u[0] * x + u[1] * y + u[2] * z;
      const cx = u[1] * z - u[2] * y, cy = u[2] * x - u[0] * z, cz = u[0] * y - u[1] * x;
      [x, y, z] = [x * c + cx * s + u[0] * dot * (1 - c), y * c + cy * s + u[1] * dot * (1 - c), z * c + cz * s + u[2] * dot * (1 - c)];
    } else if (c < 0) {
      // d already points up (+Z): flip upside down around X.
      [y, z] = [-y, -z];
    }
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    minZ = Math.min(minZ, z);
  }
  for (let i = 2; i < out.length; i += 3) out[i] -= minZ;
  return { positions: out, indices: mesh.indices };
}

/** Lays a part's separate bodies out in a compact grid on z = 0 (loose pins). */
export function packComponents(wasm: Wasm, m: Manifold): Manifold {
  const comps = m.decompose();
  const gap = 3;
  const cols = Math.ceil(Math.sqrt(comps.length));
  const placed: Manifold[] = [];
  let x = 0, y = 0, rowH = 0;
  comps.forEach((c, i) => {
    if (i > 0 && i % cols === 0) { x = 0; y += rowH + gap; rowH = 0; }
    const b = c.boundingBox();
    placed.push(c.translate([x - b.min[0], y - b.min[1], -b.min[2]]));
    x += b.max[0] - b.min[0] + gap;
    rowH = Math.max(rowH, b.max[1] - b.min[1]);
  });
  const out = wasm.Manifold.compose(placed);
  [...comps, ...placed].forEach((c) => c.delete());
  return out;
}

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

  /** SmartCut: suggested bounded plane separating the seeded region (state before `beforeOp` when editing). */
  smartCut(partId: string, seeds: Vec3[], seedRadius: number, beforeOp?: string): SmartCutSuggestion {
    const m = this.engine.part(partId, beforeOp);
    if (!m) throw new Error('Parte não encontrada.');
    return this.smartCutOn(m, seeds, seedRadius);
  }

  smartCutOn(m: Manifold, seeds: Vec3[], seedRadius: number): SmartCutSuggestion {
    // Coarse CAD meshes (long thin triangles) hide creases: resample them evenly first.
    const box = m.boundingBox();
    const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const dense = m.numTri() < 150_000 ? m.refineToLength(diag / 120) : null;
    try {
      return suggestSmartCut(manifoldToMeshData(dense ?? m), seeds, seedRadius);
    } finally {
      dense?.delete();
    }
  }

  /** Overhangs, base and thin walls of a part as it sits now. */
  analyze(partId: string, tech: Technology) {
    const m = this.engine.part(partId);
    if (!m) throw new Error('Parte não encontrada.');
    return analyzePrintability(m, tech);
  }

  /** Best side to put on the plate, considering this part's cut faces. */
  orientation(partId: string, tech: Technology): OrientationSuggestion {
    const m = this.engine.part(partId);
    if (!m) throw new Error('Parte não encontrada.');
    const state = this.engine.finalState();
    const faces: { normal: Vec3; label: string }[] = [];
    for (const j of state?.joints.values() ?? []) {
      if (!j.planar) continue;
      // A's cut face points along +n, B's along −n: "face down" means down = that direction.
      if (j.a === partId) faces.push({ normal: j.plane.normal, label: j.label });
      if (j.b === partId) faces.push({ normal: [-j.plane.normal[0], -j.plane.normal[1], -j.plane.normal[2]], label: j.label });
    }
    return suggestOrientation(m, tech, faces);
  }

  /** Operations that split a part so every piece fits the build volume. */
  autoSplit(partId: string, volume: Vec3, tech: Technology, margin = 4): AutoSplitPlan {
    const m = this.engine.part(partId);
    if (!m) throw new Error('Parte não encontrada.');
    let n = 0;
    const stamp = Date.now().toString(36);
    return planAutoSplit(this.wasm, m, partId, volume, tech, margin, () => `as${stamp}${(n++).toString(36)}`);
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
      // Loose pins sit in assembled position in the scene; print them packed side by side.
      const printable = p.id.endsWith('.pins') ? packComponents(this.wasm, m) : m;
      const mesh = manifoldToMeshData(printable);
      if (printable !== m) printable.delete();
      return { ...p, mesh: p.down ? orientDown(mesh, p.down) : mesh };
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
