import type { Manifold } from 'manifold-3d';
import { partStats } from './analysis';
import { applyConnector } from './connectors';
import { CutError, cutByPlane, faceSection } from './cut';
import { toDisplayMesh } from './display';
import { planeFrame } from './math';
import { manifoldToMeshData } from './repair';
import { cutByCutter, cutterReach, profileCutter, strokeCutter } from './cutters';
import type { CutOperation, EvalResult, JointInfo, Operation, OpReport, PartId, PartResult, PartStats, Plane, SourceRef } from './types';
import type { Wasm } from './wasm';

interface PartState {
  m: Manifold;
  name: string;
  version: number;
  producedBy?: string;
  stats?: PartStats;
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

  evaluate(sources: SourceRef[], ops: Operation[], full = false): EvalResult {
    const t0 = performance.now();
    const baseKey = JSON.stringify(sources);
    if (baseKey !== this.baseKey || !this.base) {
      this.invalidateAll();
      this.baseKey = baseKey;
      const parts = new Map<PartId, PartState>();
      for (const s of sources) {
        const src = this.sources.get(s.id);
        if (src) parts.set(s.id, { m: src.m, name: s.name, version: src.version });
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
      const r: PartResult = { id, name: p.name, version: p.version, stats: p.stats, producedBy: p.producedBy };
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
      const state = op.kind === 'connector' ? this.applyConnector(prev, op) : this.applyCut(prev, op);
      return { key, opId: op.id, state: state.state, report: { warnings: state.warnings, info: state.info } };
    } catch (e) {
      const message = e instanceof CutError || e instanceof Error ? e.message : String(e);
      return { key, opId: op.id, state: prev, report: { error: message, warnings: [] } };
    }
  }

  /** Runs any cut operation; returns the two halves and the joint geometry. */
  private cutGeometry(target: Manifold, op: CutOperation) {
    if (op.kind === 'cut-surface') {
      const cutter = strokeCutter(this.wasm, op.frame, op.points, cutterReach(target));
      const res = cutByCutter(this.wasm, target, cutter);
      cutter.delete();
      const { a, b } = op.flip ? { a: res.b, b: res.a } : res;
      return { a, b, planar: false, plane: { origin: op.frame.origin, normal: op.frame.u } as Plane };
    }
    if (op.profile && op.profile.amplitude > 0) {
      if (op.bounded) throw new CutError('Corte limitado ainda não combina com perfil (degrau/zigue-zague/onda).');
      const cutter = profileCutter(this.wasm, op.plane, op.profile, cutterReach(target));
      const res = cutByCutter(this.wasm, target, cutter);
      cutter.delete();
      return { ...res, planar: false, plane: op.plane };
    }
    return { ...cutByPlane(this.wasm, target, op.plane, op.bounded), planar: true, plane: op.plane };
  }

  private applyCut(prev: State, op: CutOperation) {
    const target = prev.parts.get(op.target);
    if (!target) throw new Error('A parte alvo deste corte não existe mais.');
    const { a, b, planar, plane } = this.cutGeometry(target.m, op);
    const ids = cutPartIds(op.id);
    const fromSource = this.sources.has(op.target);
    const parts = new Map<PartId, PartState>();
    for (const [id, p] of prev.parts) {
      if (id !== op.target) {
        parts.set(id, p);
        continue;
      }
      parts.set(ids.a, { m: a, name: childName(target.name, 'a', fromSource), version: this.versionSeq++, producedBy: op.id });
      parts.set(ids.b, { m: b, name: childName(target.name, 'b', fromSource), version: this.versionSeq++, producedBy: op.id });
    }
    let faceArea: number;
    if (planar) {
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
    joints.set(op.id, { id: op.id, a: ids.a, b: ids.b, plane, bounded: op.kind === 'cut-plane' ? op.bounded : undefined, faceArea, label, planar });
    return { state: { parts, joints }, warnings: [] as string[], info: `${faceArea.toFixed(0)} mm² de face` };
  }

  private applyConnector(prev: State, op: Extract<Operation, { kind: 'connector' }>) {
    const joint = prev.joints.get(op.joint);
    if (!joint) throw new Error('O corte deste encaixe não existe mais.');
    const a = prev.parts.get(joint.a), b = prev.parts.get(joint.b);
    if (!a || !b) throw new Error('As partes deste encaixe foram cortadas depois; mova o encaixe para logo após o corte.');
    if (!joint.planar) throw new Error('Encaixes precisam de um corte plano sem perfil — o perfil/curva já trava a montagem.');
    const res = applyConnector(this.wasm, a.m, b.m, joint, op.type, op.params);
    if (res.placed === 0) {
      res.a.delete();
      res.b.delete();
      res.pins?.delete();
      throw new Error(res.warnings[0] ?? 'Nenhum pino coube nesta face.');
    }
    const parts = new Map<PartId, PartState>();
    for (const [id, p] of prev.parts) {
      if (id === joint.a) parts.set(id, { ...p, m: res.a, version: this.versionSeq++, stats: undefined });
      else if (id === joint.b) parts.set(id, { ...p, m: res.b, version: this.versionSeq++, stats: undefined });
      else parts.set(id, p);
    }
    if (res.pins) {
      parts.set(pinsPartId(op.id), { m: res.pins, name: `Pinos ${joint.label}`, version: this.versionSeq++, producedBy: op.id });
    }
    const noun = op.type === 'pin' ? 'pino(s)' : 'pino(s) solto(s)';
    return { state: { parts, joints: prev.joints }, warnings: [...new Set(res.warnings)], info: `${res.placed} ${noun}` };
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
