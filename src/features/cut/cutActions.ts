import { geometry } from '../../geometry/client';
import { defaultConnectorParams } from '../../geometry/connectors';
import type { CutOperation, CutProfile, Operation, PartId, Plane, StrokeFrame, Vec2, Vec3 } from '../../geometry/types';
import { addOperation, batch, insertOperationAfter, removeOperation, updateOperation, type Command } from '../../store/commands';
import { dispatch, getDoc } from '../../store/history';
import { newId } from '../../store/project';
import { toBufferGeometry } from '../../store/sync';
import { setUI, toast, useUI, type CutDraft } from '../../store/ui';

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
  setUI({ tool: 'cut', draft, selection: id, connectorEdit: null });
}

/** SmartCut brush: paint (or click) the region to separate, then ask for a suggestion. */
export function startBrush(partId?: PartId) {
  const { selection, brush } = useUI.getState();
  cancelCut();
  const target = partId ?? selection ?? null;
  setUI({ tool: 'brush', explode: 0, connectorEdit: null, brush: { ...brush, target, seeds: brush.target === target ? brush.seeds : [] } });
}

export function clearBrush() {
  const { brush } = useUI.getState();
  setUI({ brush: { ...brush, seeds: [] } });
}

export async function suggestFromBrush() {
  const { brush } = useUI.getState();
  if (!brush.target || brush.seeds.length === 0) {
    toast('info', 'Pincele a região que quer separar', 'Ex.: passe o pincel sobre o braço — ou só clique na ponta dele.');
    return;
  }
  setUI({ busy: true, busyLabel: 'Procurando a articulação…' });
  try {
    const s = await geometry().smartCut(brush.target, brush.seeds, brush.radius);
    const draft = baseDraft(brush.target, s.plane, s.radius);
    draft.bounded = true;
    draft.smartRing = s.ring;
    setUI({ tool: 'cut', draft, selection: brush.target, brush: { ...brush, seeds: [] } });
    toast(
      s.confidence > 0.35 ? 'success' : 'info',
      s.confidence > 0.35 ? 'Articulação encontrada' : 'Sugestão de corte (confiança baixa)',
      `Anel de ${s.perimeter.toFixed(0)} mm. Ajuste o plano se quiser e pressione Enter.`,
    );
  } catch (e) {
    toast('warning', 'SmartCut não encontrou um corte', e instanceof Error ? e.message : String(e), 7000);
  } finally {
    setUI({ busy: false });
  }
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
  setUI({ tool: 'cut', draft });
}

/** Re-opens an existing cut for editing (later operations recompute on commit). */
export async function editCut(opId: string) {
  const doc = getDoc();
  const op = doc.operations.find((o): o is CutOperation => o.id === opId && (o.kind === 'cut-plane' || o.kind === 'cut-surface'));
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
  const draft = baseDraft(op.target, op.kind === 'cut-plane' ? op.plane : { origin: op.frame.origin, normal: op.frame.u }, Math.max(max.x - min.x, max.y - min.y, max.z - min.z) * 0.3);
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
  } else {
    draft.mode = 'surface';
    draft.surface = { frame: op.frame, points: op.points, flip: !!op.flip };
  }
  setUI({ tool: 'cut', connectorEdit: null, selection: null, draft });
}

export function updateDraft(patch: Partial<CutDraft>) {
  const draft = useUI.getState().draft;
  if (draft) setUI({ draft: { ...draft, ...patch } });
}

export function cancelCut() {
  useUI.getState().draft?.previewGeometry?.dispose();
  const { tool } = useUI.getState();
  setUI({ draft: null, tool: tool === 'cut' || tool === 'draw' ? 'select' : tool });
}

function draftToOperation(draft: CutDraft, id: string): CutOperation {
  if (draft.mode === 'surface' && draft.surface) {
    return { kind: 'cut-surface', id, target: draft.target, frame: draft.surface.frame, points: draft.surface.points, ...(draft.surface.flip ? { flip: true } : {}) };
  }
  const profiled = draft.profile && draft.profile.amplitude > 0;
  return {
    kind: 'cut-plane',
    id,
    target: draft.target,
    plane: draft.plane,
    ...(draft.bounded && !profiled ? { bounded: { center: draft.plane.origin, radius: draft.radius } } : {}),
    ...(profiled ? { profile: draft.profile! } : {}),
  };
}

/** Connectors need a flat, unprofiled plane cut. */
export const draftAllowsConnector = (d: CutDraft) => d.mode === 'plane' && !(d.profile && d.profile.amplitude > 0);

export function commitCut() {
  const draft = useUI.getState().draft;
  if (!draft) return;
  const doc = getDoc();
  const editing = draft.editingOpId;
  const cutId = editing ?? newId('c');
  const cut = draftToOperation(draft, cutId);
  const cmds: Command[] = [editing ? updateOperation(cut, 'Editar corte') : addOperation(cut, 'Corte')];
  const c = draft.connector;
  const withConnector = c.enabled && draftAllowsConnector(draft);
  if (withConnector) {
    const op: Operation = { kind: 'connector', id: draft.connectorOpId ?? newId('k'), joint: cutId, type: c.type, params: c.params };
    cmds.push(draft.connectorOpId ? updateOperation(op, 'Editar encaixe') : insertOperationAfter(cutId, op, 'Encaixe'));
  } else if (draft.connectorOpId) {
    cmds.push(removeOperation(draft.connectorOpId, 'Remover encaixe'));
  }
  // Numbering goes after the connector so it is placed clear of the pins.
  const wantsLabel = draft.label && draftAllowsConnector(draft);
  if (wantsLabel && !draft.labelOpId) {
    const op: Operation = { kind: 'label', id: newId('l'), joint: cutId, size: 6, depth: 0.6 };
    cmds.push({
      label: 'Numeração',
      apply: (d) => {
        const ops = [...d.operations];
        const anchor = ops.find((o) => o.kind === 'connector' && o.joint === cutId)?.id ?? cutId;
        const i = ops.findIndex((o) => o.id === anchor);
        ops.splice(i < 0 ? ops.length : i + 1, 0, op);
        return { ...d, operations: ops };
      },
    });
  } else if (!wantsLabel && draft.labelOpId) {
    cmds.push(removeOperation(draft.labelOpId, 'Remover numeração'));
  }
  const n = doc.operations.filter((o) => o.kind === 'cut-plane' || o.kind === 'cut-surface').length + (editing ? 0 : 1);
  dispatch(batch(editing ? 'Editar corte' : `Corte ${n}${withConnector ? ' + encaixe' : ''}`, cmds));
  draft.previewGeometry?.dispose();
  setUI({ draft: null, tool: 'select', selection: null });
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
