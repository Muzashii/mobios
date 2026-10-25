import type { BufferGeometry } from 'three';
import { geometry } from '../geometry/client';
import type { DisplayMesh, OpReport } from '../geometry/types';
import { autoPartColor } from '../ui/tokens';
import { useHistory } from './history';
import { ensurePartMaps } from './partmaps';
import { saveDocSoon } from './persistence';
import { toast, useUI, type ViewPart } from './ui';

// three.js is loaded on demand: the app shell paints before the 3D engine arrives.
let three: Promise<typeof import('three')> | null = null;
const loadThree = () => (three ??= import('three'));

export async function toBufferGeometry(mesh: DisplayMesh): Promise<BufferGeometry> {
  const { BufferAttribute, BufferGeometry } = await loadThree();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Stable, sequential colour per part: halves of a cut always differ.
const colorIndex = new Map<string, number>();
let colorSeq = 0;
const colorFor = (id: string) => {
  if (!colorIndex.has(id)) colorIndex.set(id, colorSeq++);
  return autoPartColor(colorIndex.get(id)!);
};

let running = false;
let pending = false;
let pendingFull = false;

/** Re-evaluates the history in the worker. Calls made while busy collapse into one. */
export function requestEvaluate(full = false) {
  pendingFull ||= full;
  if (running) {
    pending = true;
    return;
  }
  void run();
}

async function run() {
  running = true;
  const busyTimer = setTimeout(() => useUI.setState({ busy: true, busyLabel: 'Calculando…' }), 120);
  try {
    do {
      pending = false;
      const full = pendingFull;
      pendingFull = false;
      const { doc } = useHistory.getState();
      const result = await geometry().evaluate(doc.sources, doc.operations, full);
      await apply(result.parts, result.reports, result.ms);
      useUI.setState({ joints: result.joints });
      ensurePartMaps();
    } while (pending);
  } catch (e) {
    toast('error', 'Falha no motor geométrico', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(busyTimer);
    running = false;
    useUI.setState({ busy: false });
  }
}

async function apply(results: Awaited<ReturnType<ReturnType<typeof geometry>['evaluate']>>['parts'], reports: Record<string, OpReport>, ms: number) {
  // Build GPU geometries first (async: three.js may still be loading), then read state.
  const built = new Map<string, BufferGeometry>();
  for (const r of results) if (r.mesh) built.set(r.id, await toBufferGeometry(r.mesh));
  const prev = useUI.getState();
  const byId = new Map(prev.parts.map((p) => [p.id, p]));
  const next: ViewPart[] = [];
  results.forEach((r) => {
    const old = byId.get(r.id);
    let geometryObj = old?.geometry;
    if (r.mesh) {
      geometryObj = built.get(r.id)!;
      if (old) old.geometry.dispose();
    } else if (!old) {
      return; // should not happen: worker always sends unknown versions
    }
    byId.delete(r.id);
    next.push({
      id: r.id,
      name: r.name,
      version: r.version,
      geometry: geometryObj!,
      stats: r.stats,
      producedBy: r.producedBy,
      lineage: r.lineage,
      autoColor: colorFor(r.id),
    });
  });
  for (const gone of byId.values()) gone.geometry.dispose();

  // Surface new problems once; many at once (a whole split) become one summary.
  const errors: string[] = [], warnings: string[] = [];
  for (const [opId, rep] of Object.entries(reports)) {
    const before = prev.reports[opId];
    if (rep.error && rep.error !== before?.error) errors.push(rep.error);
    else if (rep.warnings.length && rep.warnings.join() !== before?.warnings.join()) warnings.push(rep.warnings.join(' '));
  }
  if (errors.length) toast('error', errors.length > 1 ? `${errors.length} operações com erro` : 'Operação com erro', errors.length > 1 ? `${errors[0]} Veja o Histórico.` : errors[0], 6000);
  if (warnings.length) toast('warning', warnings.length > 1 ? `${warnings.length} avisos` : 'Atenção', warnings.length > 1 ? `${warnings[0]} Os outros estão no Histórico.` : warnings[0], 6000);

  const ids = new Set(next.map((p) => p.id));
  useUI.setState({
    parts: next,
    reports,
    lastEvalMs: ms,
    selection: prev.selection && ids.has(prev.selection) ? prev.selection : null,
    hovered: null,
  });
}

/** Wires document changes to evaluation and autosave. Call once at startup. */
export function startSync() {
  return useHistory.subscribe((s, prev) => {
    if (s.doc === prev.doc) return;
    saveDocSoon(s.doc);
    if (s.doc.sources !== prev.doc.sources || s.doc.operations !== prev.doc.operations) requestEvaluate();
    else if (s.doc.partMaps !== prev.doc.partMaps) ensurePartMaps();
  });
}
