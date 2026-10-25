import type { Manifold } from 'manifold-3d';
import { partStats } from './analysis';
import { applyConnector, CONNECTOR_TYPES } from './connectors';
import { engraveLabel } from './labels';
import { hollowPart } from './hollow';
import { CutError, cutByPlane, faceSection } from './cut';
import { toDisplayMesh } from './display';
import { planeFrame } from './math';
import { cutRegion } from './regionCut';
import { manifoldToMeshData } from './repair';
import { regionContext } from './smartcut';
import { boundedProfileCut, cutByCutter, cutterReach, strokeCutter } from './cutters';
import type { CutCheck, CutOperation, EvalResult, JointInfo, Operation, OpReport, PartId, PartResult, PartStats, Plane, SourceRef, Vec3 } from './types';
import type { Wasm } from './wasm';

interface PartState {
  m: Manifold;
  name: string;
  version: number;
  producedBy?: string;
  stats?: PartStats;
  lineage: string[];
}

interface State {
  parts: Map<PartId, PartState>;
  joints: Map<string, JointInfo>;
}

interface Step {
  key: string;
  opId: string;
  state: State;
  report: OpReport;
}

/** Deterministic ids: re-running the history yields the same part ids. */
export const cutPartIds = (opId: string) => ({ a: `${opId}.a`, b: `${opId}.b` });
export const pinsPartId = (opId: string) => `${opId}.pins`;

function childName(parent: string, side: 'a' | 'b', fromSource: boolean) {
  if (fromSource) return `${parent} ${side === 'a' ? 'A' : 'B'}`;
  return /[A-Z]$/.test(parent) ? `${parent}${side === 'a' ? 1 : 2}` : `${parent}${side}`;
}

/**
 * Re-executes the operation history with a prefix cache: editing operation i
 * only recomputes i..n. All results are manifold (manifold-3d guarantees it).
 */
export class Engine {
  private sources = new Map<PartId, { m: Manifold; version: number }>();
  private baseKey = '';
  private base: State | null = null;
  private steps: Step[] = [];
  private sent = new Map<PartId, number>();
  private versionSeq = 1;

  constructor(private wasm: Wasm) {}

  addSource(id: PartId, m: Manifold) {
    const old = this.sources.get(id);
    if (old) {
      this.invalidateAll();
      old.m.delete();
    }
    this.sources.set(id, { m, version: this.versionSeq++ });
  }

  hasSource(id: PartId) {
    return this.sources.has(id);
  }

  /** The imported solid behind a source id (before any operation). */
  source(id: PartId): Manifold | undefined {
    return this.sources.get(id)?.m;
  }

  evaluate(sources: SourceRef[], ops: Operation[], full = false): EvalResult {
    const t0 = performance.now();
    const baseKey = JSON.stringify(sources);
    if (baseKey !== this.baseKey || !this.base) {
      this.invalidateAll();
      this.baseKey = baseKey;
      const parts = new Map<PartId, PartState>();
      for (const s of sources) {
        const src = this.sources.get(s.id);
        if (src) parts.set(s.id, { m: src.m, name: s.name, version: src.version, lineage: [] });
      }
      this.base = { parts, joints: new Map() };
    }

    let i = 0;
    while (i < ops.length && i < this.steps.length && this.steps[i].key === JSON.stringify(ops[i])) i++;
    this.truncate(i);
    for (; i < ops.length; i++) {
      const prev = i === 0 ? this.base! : this.steps[i - 1].state;
      this.steps.push(this.apply(prev, ops[i]));
    }

    const final = ops.length ? this.steps[ops.length - 1].state : this.base!;
    if (full) this.sent.clear();
    const parts: PartResult[] = [];
    for (const [id, p] of final.parts) {
      p.stats ??= partStats(p.m);
      const r: PartResult = { id, name: p.name, version: p.version, stats: p.stats, producedBy: p.producedBy, lineage: p.lineage };
      if (this.sent.get(id) !== p.version) {
        r.mesh = toDisplayMesh(manifoldToMeshData(p.m));
        this.sent.set(id, p.version);
      }
      parts.push(r);
    }
    for (const id of [...this.sent.keys()]) if (!final.parts.has(id)) this.sent.delete(id);

    const reports: Record<string, OpReport> = {};
    for (const s of this.steps) reports[s.opId] = s.report;
    return { parts, joints: [...final.joints.values()], reports, ms: performance.now() - t0 };
  }

  /** State right before the given operation (used to preview edits of old cuts). */
  stateBefore(opId: string): State | null {
    const idx = this.steps.findIndex((s) => s.opId === opId);
    if (idx < 0) return null;
    return idx === 0 ? this.base : this.steps[idx - 1].state;
  }

  finalState(): State | null {
    return this.steps.length ? this.steps[this.steps.length - 1].state : this.base;
  }

  part(id: PartId, beforeOp?: string): Manifold | undefined {
    const state = beforeOp ? this.stateBefore(beforeOp) : this.finalState();
    return state?.parts.get(id)?.m;
  }

  private apply(prev: State, op: Operation): Step {
    const key = JSON.stringify(op);
    try {
      const state = op.kind === 'connector' ? this.applyConnector(prev, op) : op.kind === 'label' ? this.applyLabel(prev, op) : op.kind === 'hollow' ? this.applyHollow(prev, op) : this.applyCut(prev, op);
      return { key, opId: op.id, state: state.state, report: { warnings: state.warnings, info: state.info } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const hint = e instanceof CutError ? e.hint : undefined;
      return { key, opId: op.id, state: prev, report: { error: message, ...(hint ? { hint } : {}), warnings: [] } };
    }
  }

  /**
   * Dry-run of a cut (pre-validation while the user edits the draft): runs the real geometry
   * on the target as it is right before `beforeOp` (or now), reports and frees everything.
   */
  checkCut(op: CutOperation, beforeOp?: string): CutCheck {
    const state = beforeOp ? this.stateBefore(beforeOp) : this.finalState();
    const target = state?.parts.get(op.target);
    const empty = { piecesA: 0, piecesB: 0, volumeA: 0, volumeB: 0, warnings: [] as string[] };
    if (!target) return { ok: false, error: 'A parte alvo deste corte não existe mais.', ...empty };
    try {
      const g = this.cutGeometry(target.m, op);
      const count = (m: Manifold) => {
        const parts = m.decompose();
        const n = parts.filter((x) => Math.abs(x.volume()) > Math.abs(m.volume()) * 1e-6).length;
        parts.forEach((x) => x.delete());
        return n;
      };
      const res: CutCheck = {
        ok: true,
        piecesA: count(g.a),
        piecesB: count(g.b),
        volumeA: g.a.volume(),
        volumeB: g.b.volume(),
        warnings: g.warnings,
        previewB: op.kind === 'cut-region' ? toDisplayMesh(manifoldToMeshData(g.b)) : undefined,
      };
      g.a.delete();
      g.b.delete();
      return res;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), hint: e instanceof CutError ? e.hint : undefined, ...empty };
    }
  }

  /** Runs any cut operation; returns the two halves and the joint geometry. */
  private cutGeometry(target: Manifold, op: CutOperation): { a: Manifold; b: Manifold; planar: boolean; plane: Plane; insertDir: Vec3; faceRadius?: number; warnings: string[] } {
    if (op.kind === 'cut-region') {
      const ctx = regionContext(target, 'apply');
      const r = cutRegion(this.wasm, target, ctx, op);
      return { a: r.a, b: r.b, planar: r.planar, plane: r.plane, insertDir: r.plane.normal, faceRadius: r.faceRadius, warnings: r.warnings };
    }
    if (op.kind === 'cut-surface') {
      const cutter = strokeCutter(this.wasm, op.frame, op.points, cutterReach(target));
      const res = cutByCutter(this.wasm, target, cutter);
      cutter.delete();
      const { a, b } = op.flip ? { a: res.b, b: res.a } : res;
      // B lies left of the stroke: it comes off along the stroke's left normal (mid-point).
      const i = Math.max(1, Math.floor(op.points.length / 2));
      const p0 = op.points[i - 1], p1 = op.points[Math.min(i, op.points.length - 1)];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
      const lx = -(p1[1] - p0[1]) / len, ly = (p1[0] - p0[0]) / len;
      const sign = op.flip ? -1 : 1;
      const dir = [0, 1, 2].map((k) => sign * (op.frame.u[k] * lx + op.frame.v[k] * ly)) as Vec3;
      return { a, b, planar: false, plane: { origin: op.frame.origin, normal: dir } as Plane, insertDir: dir, warnings: [] };
    }
    if (op.profile && op.profile.amplitude > 0) {
      const res = boundedProfileCut(this.wasm, target, op.plane, op.profile, op.bounded);
      return { ...res, planar: false, plane: op.plane, insertDir: op.plane.normal, warnings: [] };
    }
    return { ...cutByPlane(this.wasm, target, op.plane, op.bounded), planar: true, plane: op.plane, insertDir: op.plane.normal, warnings: [] };
  }

  private applyCut(prev: State, op: CutOperation) {
    const target = prev.parts.get(op.target);
    if (!target) throw new Error('A parte alvo deste corte não existe mais.');
    const { a, b, planar, plane, insertDir, faceRadius, warnings } = this.cutGeometry(target.m, op);
    const ids = cutPartIds(op.id);
    const fromSource = this.sources.has(op.target);
    const nameB = op.kind === 'cut-region' && op.name ? op.name : childName(target.name, 'b', fromSource);
    const parts = new Map<PartId, PartState>();
    for (const [id, p] of prev.parts) {
      if (id !== op.target) {
        parts.set(id, p);
        continue;
      }
      parts.set(ids.a, { m: a, name: childName(target.name, 'a', fromSource), version: this.versionSeq++, producedBy: op.id, lineage: [...target.lineage, ids.a] });
      parts.set(ids.b, { m: b, name: nameB, version: this.versionSeq++, producedBy: op.id, lineage: [...target.lineage, ids.b] });
    }
    let faceArea: number;
    if (planar && !faceRadius) {
      const section = faceSection(b, planeFrame(plane).toLocal);
      faceArea = section.area();
      section.delete();
    } else {
      // Each half gains the cut surface once.
      faceArea = Math.max(0, (a.surfaceArea() + b.surfaceArea() - target.m.surfaceArea()) / 2);
    }
    const cutCount = [...prev.joints.values()].length + 1;
    const joints = new Map(prev.joints);
    const label = `J${cutCount}`;
    joints.set(op.id, { id: op.id, a: ids.a, b: ids.b, plane, bounded: op.kind === 'cut-plane' ? op.bounded : undefined, faceArea, label, planar, ...(faceRadius ? { faceRadius } : {}), insertDir, obstacles: [] });
    const shape = op.kind === 'cut-region' ? (op.mode === 'shell' ? ' · casca' : faceRadius ? ' · junta curva' : planar ? ' · plano' : ' · junta livre') : '';
    return { state: { parts, joints }, warnings, info: `${faceArea.toFixed(0)} mm² de face${shape}` };
  }

  private applyConnector(prev: State, op: Extract<Operation, { kind: 'connector' }>) {
    const joint = prev.joints.get(op.joint);
    if (!joint) throw new Error('O corte deste encaixe não existe mais.');
    const a = prev.parts.get(joint.a), b = prev.parts.get(joint.b);
    if (!a || !b) throw new Error('As partes deste encaixe foram cortadas depois; mova o encaixe para logo após o corte.');
    // A connector that cannot be placed never undoes the cut: it becomes a warning.
    const skip = (why: string) => ({ state: prev, warnings: [why], info: 'encaixe não aplicado' });
    if (!joint.planar) return skip('Esta junta não tem área plana para pinos — o perfil/curva/casca já trava a montagem.');
    const res = applyConnector(this.wasm, a.m, b.m, joint, op.type, op.params);
    if (res.placed === 0) {
      res.a.delete();
      res.b.delete();
      res.pins?.delete();
      return skip(`${res.warnings[0] ?? 'Nenhum pino coube nesta face.'} Reduza o diâmetro do encaixe.`);
    }
    const parts = new Map<PartId, PartState>();
    for (const [id, p] of prev.parts) {
      if (id === joint.a) parts.set(id, { ...p, m: res.a, version: this.versionSeq++, stats: undefined });
      else if (id === joint.b) parts.set(id, { ...p, m: res.b, version: this.versionSeq++, stats: undefined });
      else parts.set(id, p);
    }
    if (res.pins) {
      parts.set(pinsPartId(op.id), { m: res.pins, name: `Pinos ${joint.label}`, version: this.versionSeq++, producedBy: op.id, lineage: [`${op.joint}.pins`] });
    }
    const clear = res.sweepOverlap < 0.01;
    const joints = new Map(prev.joints);
    joints.set(joint.id, { ...joint, insertDir: res.insertDir, obstacles: [...joint.obstacles, ...res.obstacles], assemblyClear: clear });
    const warnings = [...new Set(res.warnings)];
    if (!clear) warnings.push(`Colisão na montagem simulada (${res.sweepOverlap.toFixed(2)} mm³): aumente a folga.`);
    const label = CONNECTOR_TYPES.find((t) => t.value === op.type)?.label.toLowerCase() ?? op.type;
    return { state: { parts, joints }, warnings, info: `${res.placed}× ${label}${clear ? ' · montagem sem colisão ✓' : ''}` };
  }

  private applyHollow(prev: State, op: Extract<Operation, { kind: 'hollow' }>) {
    const target = prev.parts.get(op.target);
    if (!target) throw new Error('A parte deste oco não existe mais.');
    const res = hollowPart(this.wasm, target.m, op.wall, op.drainDiameter, op.drainCount);
    const parts = new Map(prev.parts);
    parts.set(op.target, { ...target, m: res.part, version: this.versionSeq++, stats: undefined });
    const saved = (res.removed / 1000).toFixed(1);
    return {
      state: { parts, joints: prev.joints },
      warnings: res.warnings,
      info: `parede ${op.wall} mm · ${res.drains} dreno(s) · −${saved} cm³ de resina`,
    };
  }

  private applyLabel(prev: State, op: Extract<Operation, { kind: 'label' }>) {
    const joint = prev.joints.get(op.joint);
    if (!joint) throw new Error('O corte desta numeração não existe mais.');
    if (!joint.planar) return { state: prev, warnings: ['A numeração precisa de uma área plana na junta; não foi gravada.'], info: 'numeração não aplicada' };
    const a = prev.parts.get(joint.a), b = prev.parts.get(joint.b);
    if (!a || !b) throw new Error('As partes desta junta foram cortadas depois; mova a numeração para logo após o corte.');
    let res: ReturnType<typeof engraveLabel>;
    try {
      res = engraveLabel(this.wasm, a.m, b.m, joint, joint.label, op.size, op.depth);
    } catch (e) {
      return { state: prev, warnings: [e instanceof Error ? e.message : String(e)], info: 'numeração não aplicada' };
    }
    const parts = new Map<PartId, PartState>();
    for (const [id, p] of prev.parts) {
      if (id === joint.a) parts.set(id, { ...p, m: res.a, version: this.versionSeq++, stats: undefined });
      else if (id === joint.b) parts.set(id, { ...p, m: res.b, version: this.versionSeq++, stats: undefined });
      else parts.set(id, p);
    }
    const warnings = res.size < op.size - 1e-6 ? [`Texto reduzido para ${res.size.toFixed(1)} mm para caber na face.`] : [];
    return { state: { parts, joints: prev.joints }, warnings, info: `"${joint.label}" gravado nas duas faces` };
  }

  private referenced(states: State[]) {
    const keep = new Set<Manifold>();
    for (const s of this.sources.values()) keep.add(s.m);
    for (const st of states) for (const p of st.parts.values()) keep.add(p.m);
    return keep;
  }

  private truncate(n: number) {
    if (n >= this.steps.length) return;
    const dropped = this.steps.splice(n);
    const keep = this.referenced([...(this.base ? [this.base] : []), ...this.steps.map((s) => s.state)]);
    const freed = new Set<Manifold>();
    for (const s of dropped) for (const p of s.state.parts.values()) {
      if (!keep.has(p.m) && !freed.has(p.m)) {
        freed.add(p.m);
        p.m.delete();
      }
    }
  }

  private invalidateAll() {
    this.truncate(0);
    this.base = null;
    this.baseKey = '';
  }

  dispose() {
    this.invalidateAll();
    for (const s of this.sources.values()) s.m.delete();
    this.sources.clear();
  }
}
