import { geometry } from '../../geometry/client';
import { defaultConnectorParams } from '../../geometry/connectors';
import type { CutHint, CutOperation, CutProfile, Operation, PartId, Plane, RegionCutMode, SmartCutSuggestion, StrokeFrame, Vec2, Vec3 } from '../../geometry/types';
import { addOperation, batch, insertOperationAfter, removeOperation, updateOperation, type Command } from '../../store/commands';
import { dispatch, getDoc } from '../../store/history';
import { newId } from '../../store/project';
import { toBufferGeometry } from '../../store/sync';
import { setUI, toast, useUI, type CutDraft, type RegionDraft } from '../../store/ui';

/** Bounding box of a part (plain numbers: keeps three.js out of the initial bundle). */
export function partBounds(id: PartId): { center: Vec3; size: Vec3; diag: number } | null {
  const part = useUI.getState().parts.find((p) => p.id === id);
  if (!part) return null;
  part.geometry.computeBoundingBox();
  const { min, max } = part.geometry.boundingBox!;
  const size: Vec3 = [max.x - min.x, max.y - min.y, max.z - min.z];
  return { center: [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2], size, diag: Math.hypot(...size) };
}

function connectorDefaults() {
  const doc = getDoc();
  return { ...defaultConnectorParams(doc.technology), clearance: doc.clearance[doc.technology] };
}

export const DEFAULT_PROFILE: CutProfile = { kind: 'zigzag', amplitude: 4, period: 12 };

/** Part the tools act on: explicit id, selection, or the only visible part. */
export function resolveTarget(partId?: PartId): PartId | null {
  const { parts, selection } = useUI.getState();
  const doc = getDoc();
  const visible = parts.filter((p) => doc.partMeta[p.id]?.visible !== false);
  const id = partId ?? selection ?? (visible.length === 1 ? visible[0].id : null);
  if (!id) {
    toast('info', 'Selecione uma parte primeiro', 'Clique numa parte no viewport ou na lista de partes.');
    return null;
  }
  if (doc.partMeta[id]?.locked) {
    toast('warning', 'Parte travada', 'Destrave a parte na lista para cortá-la.');
    return null;
  }
  return id;
}

function baseDraft(target: PartId, plane: Plane, radius: number): CutDraft {
  return {
    target,
    mode: 'plane',
    plane,
    profile: null,
    bounded: false,
    radius,
    connector: { enabled: true, type: 'pin', params: connectorDefaults() },
    label: true,
  };
}

/** Enters the plane-cut tool on a part (selection, or the only part). */
export function startCut(partId?: PartId) {
  const id = resolveTarget(partId);
  if (!id) return;
  const box = partBounds(id);
  if (!box) return;
  const draft = baseDraft(id, { origin: box.center, normal: [0, 0, 1] }, Math.max(...box.size) * 0.3);
  setDraft(draft, { tool: 'cut', selection: id, connectorEdit: null });
}

/** SmartCut: hover shows the part, click/brush picks it, Enter suggests. */
export function startBrush(partId?: PartId) {
  const { selection, brush } = useUI.getState();
  cancelCut();
  const target = partId ?? selection ?? null;
  const same = brush.target === target;
  setUI({ tool: 'brush', explode: 0, connectorEdit: null, brush: { ...brush, target, seeds: same ? brush.seeds : [], negSeeds: same ? brush.negSeeds : [] } });
}

export function clearBrush() {
  const { brush } = useUI.getState();
  setUI({ brush: { ...brush, seeds: [], negSeeds: [] } });
}

/** Default way out for a region: hair-like creased regions as a shell is a choice, not a guess. */
const defaultMode = (): RegionCutMode => 'auto';

function regionDraftFrom(s: SmartCutSuggestion, negSeeds: Vec3[]): RegionDraft {
  const c = s.candidates[0];
  return { balls: s.balls, seeds: s.seeds, negSeeds, candidates: s.candidates, index: 0, level: c.level, mode: defaultMode(), depth: 3, name: c.name ?? '' };
}

function draftFromRegion(target: PartId, region: RegionDraft): CutDraft {
  const c = region.candidates[region.index];
  const draft = baseDraft(target, c.plane, c.radius * 1.35 + 1);
  draft.mode = 'region';
  draft.region = region;
  draft.smartRing = c.loops.flat();
  return draft;
}

export async function suggestFromBrush(seedsOverride?: Vec3[]) {
  const { brush } = useUI.getState();
  const seeds = seedsOverride ?? brush.seeds;
  if (!brush.target || seeds.length === 0) {
    toast('info', 'Clique ou pincele a parte que quer separar', 'Passe o mouse para ver a parte destacada; clique para cortar. Shift + pincel marca o que deve ficar no corpo.');
    return;
  }
  setUI({ busy: true, busyLabel: 'Procurando a articulação…' });
  try {
    const res = await geometry().smartCutClusters(brush.target, seeds, brush.radius, brush.negSeeds.length ? brush.negSeeds : undefined);
    const regions: RegionDraft[] = [];
    for (const r of res) {
      if ('suggestion' in r) regions.push(regionDraftFrom(r.suggestion, brush.negSeeds));
      else toast('warning', 'Uma das regiões não pôde ser separada', r.error, 7000);
    }
    if (!regions.length) return;
    const [first, ...rest] = regions;
    const draft = draftFromRegion(brush.target, first);
    if (rest.length) draft.batch = rest;
    setDraft(draft, { tool: 'cut', selection: brush.target, brush: { ...brush, seeds: [], negSeeds: [] }, hover: null });
    const c = first.candidates[0];
    toast(
      c.confidence > 0.35 ? 'success' : 'info',
      regions.length > 1 ? `${regions.length} cortes sugeridos` : c.confidence > 0.35 ? `${c.name && c.name !== 'Parte' ? c.name : 'Parte'} encontrada` : 'Sugestão de corte (confiança baixa)',
      `Tab troca a sugestão (${first.candidates.length}). Enter corta.`,
    );
  } catch (e) {
    toast('warning', 'SmartCut não encontrou um corte', e instanceof Error ? e.message : String(e), 7000);
  } finally {
    setUI({ busy: false });
  }
}

/** Tab: next SmartCut candidate. */
export function cycleCandidate(step = 1) {
  const draft = useUI.getState().draft;
  if (!draft?.region || draft.region.candidates.length < 2) return;
  const n = draft.region.candidates.length;
  selectCandidate((draft.region.index + step + n) % n);
}

export function selectCandidate(index: number) {
  const draft = useUI.getState().draft;
  if (!draft?.region) return;
  const c = draft.region.candidates[index];
  if (!c) return;
  const region = { ...draft.region, index, level: c.level, name: draft.region.name && draft.region.name !== draft.region.candidates[draft.region.index].name ? draft.region.name : c.name ?? '' };
  updateDraft({ region, plane: c.plane, radius: c.radius * 1.35 + 1, smartRing: c.loops.flat() });
}

export function updateRegion(patch: Partial<RegionDraft>) {
  const draft = useUI.getState().draft;
  if (draft?.region) updateDraft({ region: { ...draft.region, ...patch } });
}

/** Free-hand tool: the next stroke on the viewport becomes a cut surface. */
export function startDraw(partId?: PartId) {
  const id = resolveTarget(partId);
  if (!id) return;
  cancelCut();
  setUI({ tool: 'draw', selection: id, connectorEdit: null });
}

export function finishStroke(frame: StrokeFrame, points: Vec2[]) {
  const { selection } = useUI.getState();
  if (!selection || points.length < 2) return;
  const box = partBounds(selection);
  const draft = baseDraft(selection, { origin: frame.origin, normal: frame.u }, box ? box.diag * 0.3 : 30);
  draft.mode = 'surface';
  draft.surface = { frame, points, flip: false };
  draft.connector = { ...draft.connector, enabled: false };
  setDraft(draft, { tool: 'cut' });
}

/** Re-opens an existing cut for editing (later operations recompute on commit). */
export async function editCut(opId: string) {
  const doc = getDoc();
  const op = doc.operations.find((o): o is CutOperation => o.id === opId && (o.kind === 'cut-plane' || o.kind === 'cut-surface' || o.kind === 'cut-region'));
  if (!op) return;
  const connector = doc.operations.find((o): o is Extract<Operation, { kind: 'connector' }> => o.kind === 'connector' && o.joint === opId);
  const mesh = await geometry().partDisplayBefore(opId, op.target);
  if (!mesh) {
    toast('error', 'Não foi possível editar este corte', 'A parte original não existe mais.');
    return;
  }
  const previewGeometry = await toBufferGeometry(mesh);
  const { min, max } = previewGeometry.boundingBox!;
  useUI.getState().draft?.previewGeometry?.dispose();
  const plane = op.kind === 'cut-surface' ? { origin: op.frame.origin, normal: op.frame.u } : op.plane;
  const draft = baseDraft(op.target, plane, Math.max(max.x - min.x, max.y - min.y, max.z - min.z) * 0.3);
  draft.editingOpId = opId;
  draft.previewGeometry = previewGeometry;
  draft.connectorOpId = connector?.id;
  draft.connector = connector ? { enabled: true, type: connector.type, params: connector.params } : { ...draft.connector, enabled: false };
  const label = doc.operations.find((o) => o.kind === 'label' && o.joint === opId);
  draft.label = !!label;
  draft.labelOpId = label?.id;
  if (op.kind === 'cut-plane') {
    draft.bounded = !!op.bounded;
    draft.radius = op.bounded?.radius ?? draft.radius;
    draft.profile = op.profile ?? null;
  } else if (op.kind === 'cut-region') {
    draft.mode = 'region';
    draft.region = { balls: op.balls, seeds: op.seeds, negSeeds: op.negSeeds ?? [], candidates: [], index: 0, level: op.level, mode: op.mode, depth: op.depth ?? 3, name: op.name ?? '' };
  } else {
    draft.mode = 'surface';
    draft.surface = { frame: op.frame, points: op.points, flip: !!op.flip };
  }
  setDraft(draft, { tool: 'cut', connectorEdit: null, selection: null });
}

export function updateDraft(patch: Partial<CutDraft>) {
  const draft = useUI.getState().draft;
  if (draft) setDraft({ ...draft, ...patch });
}

/** Every draft change goes through here so the live validation follows it. */
function setDraft(draft: CutDraft | null, extra: Partial<ReturnType<typeof useUI.getState>> = {}) {
  setUI({ ...extra, draft });
  scheduleCheck();
}

export function cancelCut() {
  useUI.getState().draft?.previewGeometry?.dispose();
  useUI.getState().cutCheck?.previewB?.dispose();
  const { tool } = useUI.getState();
  setUI({ draft: null, cutCheck: null, tool: tool === 'cut' || tool === 'draw' ? 'select' : tool });
}

function regionToOperation(target: PartId, r: RegionDraft, plane: Plane, id: string): CutOperation {
  return {
    kind: 'cut-region',
    id,
    target,
    balls: r.balls,
    seeds: r.seeds,
    ...(r.negSeeds.length ? { negSeeds: r.negSeeds } : {}),
    level: r.level,
    mode: r.mode,
    ...(r.mode === 'shell' ? { depth: r.depth } : {}),
    plane,
    ...(r.name ? { name: r.name } : {}),
  };
}

export function draftToOperation(draft: CutDraft, id: string): CutOperation {
  if (draft.mode === 'surface' && draft.surface) {
    return { kind: 'cut-surface', id, target: draft.target, frame: draft.surface.frame, points: draft.surface.points, ...(draft.surface.flip ? { flip: true } : {}) };
  }
  if (draft.mode === 'region' && draft.region) return regionToOperation(draft.target, draft.region, draft.plane, id);
  const profiled = draft.profile && draft.profile.amplitude > 0;
  return {
    kind: 'cut-plane',
    id,
    target: draft.target,
    plane: draft.plane,
    ...(draft.bounded ? { bounded: { center: draft.plane.origin, radius: draft.radius } } : {}),
    ...(profiled ? { profile: draft.profile! } : {}),
  };
}

/** Connectors need a flat face: plane cuts without profile, or a curved SmartCut joint (flat centre). */
export const draftAllowsConnector = (d: CutDraft) =>
  d.mode === 'region' ? d.region?.mode !== 'shell' : d.mode === 'plane' && !(d.profile && d.profile.amplitude > 0);

// --- Live validation (dry-run in the worker, debounced, latest wins) -------------------------

let checkTimer: ReturnType<typeof setTimeout> | undefined;
let checkSeq = 0;
const checkKey = (d: CutDraft) => JSON.stringify(draftToOperation(d, 'check'));

function scheduleCheck() {
  clearTimeout(checkTimer);
  const draft = useUI.getState().draft;
  if (!draft) return;
  const key = checkKey(draft);
  const current = useUI.getState().cutCheck;
  if (current?.key === key) return;
  setUI({ cutCheck: { key, pending: true, result: current?.result ?? null, previewB: current?.previewB } });
  checkTimer = setTimeout(() => void runCheck(key), draft.mode === 'region' ? 60 : 320);
}

async function runCheck(key: string) {
  const draft = useUI.getState().draft;
  if (!draft || checkKey(draft) !== key) return;
  const seq = ++checkSeq;
  try {
    const result = await geometry().checkCut(draftToOperation(draft, 'check'), draft.editingOpId);
    if (seq !== checkSeq || useUI.getState().cutCheck?.key !== key) return;
    const previewB = result.previewB ? await toBufferGeometry(result.previewB) : undefined;
    useUI.getState().cutCheck?.previewB?.dispose();
    setUI({ cutCheck: { key, pending: false, result: { ...result, previewB: undefined }, previewB } });
  } catch (e) {
    if (seq === checkSeq) setUI({ cutCheck: { key, pending: false, result: { ok: false, error: e instanceof Error ? e.message : String(e), piecesA: 0, piecesB: 0, volumeA: 0, volumeB: 0, warnings: [] } } });
  }
}

/** pt-BR label and action for each hint the engine can give. */
export const HINTS: Record<CutHint, { label: string; run: () => void }> = {
  'grow-radius': { label: 'Aumentar o raio do limite', run: () => { const d = useUI.getState().draft; if (d) updateDraft({ radius: d.radius * 1.5 }); } },
  unbound: { label: 'Desligar o corte limitado', run: () => updateDraft({ bounded: false }) },
  'move-plane': {
    label: 'Centralizar o plano na peça',
    run: () => {
      const d = useUI.getState().draft;
      const box = d ? partBounds(d.target) : null;
      if (d && box) updateDraft({ plane: { ...d.plane, origin: box.center } });
    },
  },
  'pick-islands': { label: 'Usar o SmartCut para escolher a parte', run: () => startBrush(useUI.getState().draft?.target) },
  'use-region': { label: 'Usar o SmartCut (corte por região)', run: () => startBrush(useUI.getState().draft?.target) },
  'smaller-depth': { label: 'Reduzir a profundidade da casca', run: () => { const r = useUI.getState().draft?.region; if (r) updateRegion({ depth: Math.max(0.6, r.depth * 0.6) }); } },
};

export async function commitCut() {
  const draft = useUI.getState().draft;
  if (!draft) return;
  const doc = getDoc();
  const editing = draft.editingOpId;
  const cutId = editing ?? newId('c');
  const cut = draftToOperation(draft, cutId);

  // Nothing fails silently: run the real cut first; on error keep the draft open with the reason.
  setUI({ busy: true, busyLabel: 'Validando o corte…' });
  let check;
  try {
    check = await geometry().checkCut(cut, editing);
  } finally {
    setUI({ busy: false });
  }
  if (useUI.getState().draft !== draft) return;
  if (!check.ok) {
    useUI.getState().cutCheck?.previewB?.dispose();
    setUI({ cutCheck: { key: checkKey(draft), pending: false, result: { ...check, previewB: undefined } } });
    toast('error', 'Este corte não pode ser aplicado', check.error, 6000);
    return;
  }

  const cmds: Command[] = [editing ? updateOperation(cut, 'Editar corte') : addOperation(cut, 'Corte')];
  const withConnector = draft.connector.enabled && draftAllowsConnector(draft);
  const wantsLabel = draft.label && draftAllowsConnector(draft);
  const extras = (jointId: string, connectorOpId?: string, labelOpId?: string) => {
    if (withConnector) {
      const op: Operation = { kind: 'connector', id: connectorOpId ?? newId('k'), joint: jointId, type: draft.connector.type, params: draft.connector.params };
      cmds.push(connectorOpId ? updateOperation(op, 'Editar encaixe') : insertOperationAfter(jointId, op, 'Encaixe'));
    } else if (connectorOpId) {
      cmds.push(removeOperation(connectorOpId, 'Remover encaixe'));
    }
    // Numbering goes after the connector so it is placed clear of the pins.
    if (wantsLabel && !labelOpId) {
      const op: Operation = { kind: 'label', id: newId('l'), joint: jointId, size: 6, depth: 0.6 };
      cmds.push({
        label: 'Numeração',
        apply: (d) => {
          const ops = [...d.operations];
          const anchor = ops.find((o) => o.kind === 'connector' && o.joint === jointId)?.id ?? jointId;
          const i = ops.findIndex((o) => o.id === anchor);
          ops.splice(i < 0 ? ops.length : i + 1, 0, op);
          return { ...d, operations: ops };
        },
      });
    } else if (!wantsLabel && labelOpId) {
      cmds.push(removeOperation(labelOpId, 'Remover numeração'));
    }
  };
  extras(cutId, draft.connectorOpId, draft.labelOpId);

  // Other SmartCut clusters: each becomes its own cut, applied in the same undo step. The first
  // cut changes the part, so each later one targets the side of the previous cut that keeps
  // the body (A).
  let target = cut.target;
  let prevId = cutId;
  for (const region of draft.batch ?? []) {
    target = `${prevId}.a`;
    const id = newId('c');
    const c = region.candidates[region.index];
    cmds.push(addOperation(regionToOperation(target, region, c.plane, id), 'Corte'));
    extras(id);
    prevId = id;
  }

  const n = doc.operations.filter((o) => o.kind === 'cut-plane' || o.kind === 'cut-surface' || o.kind === 'cut-region').length + (editing ? 0 : 1);
  const count = 1 + (draft.batch?.length ?? 0);
  const title = editing ? 'Editar corte' : count > 1 ? `${count} cortes SmartCut${withConnector ? ' + encaixes' : ''}` : `Corte ${n}${withConnector ? ' + encaixe' : ''}`;
  dispatch(batch(title, cmds));
  draft.previewGeometry?.dispose();
  useUI.getState().cutCheck?.previewB?.dispose();
  setUI({ draft: null, cutCheck: null, tool: 'select', selection: null });
}

/** Snaps the draft normal to an axis (keeps the origin). */
export function snapAxis(axis: 0 | 1 | 2) {
  const draft = useUI.getState().draft;
  if (!draft) return;
  const n: Vec3 = [0, 0, 0];
  const sameAxis = Math.abs(draft.plane.normal[axis]) > 0.999;
  n[axis] = sameAxis && draft.plane.normal[axis] > 0 ? -1 : 1; // second click flips
  updateDraft({ plane: { ...draft.plane, normal: n } });
}

export function flipNormal() {
  const draft = useUI.getState().draft;
  if (!draft) return;
  if (draft.mode === 'surface' && draft.surface) {
    updateDraft({ surface: { ...draft.surface, flip: !draft.surface.flip } });
    return;
  }
  const [x, y, z] = draft.plane.normal;
  updateDraft({ plane: { ...draft.plane, normal: [-x, -y, -z] } });
}

/** Offset of the plane along its normal relative to the target's centre. */
export function draftOffsetRange(draft: CutDraft) {
  const g = draft.previewGeometry ?? useUI.getState().parts.find((p) => p.id === draft.target)?.geometry;
  if (!g) return { min: -50, max: 50, center: [0, 0, 0] as Vec3 };
  g.computeBoundingSphere();
  const s = g.boundingSphere!;
  return { min: -s.radius, max: s.radius, center: [s.center.x, s.center.y, s.center.z] as Vec3 };
}

export function editConnector(opId: string) {
  cancelCut();
  setUI({ connectorEdit: opId, selection: null, tool: 'select' });
}
