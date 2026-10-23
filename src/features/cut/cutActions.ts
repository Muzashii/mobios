import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { geometry } from '../../geometry/client';
import { defaultConnectorParams } from '../../geometry/connectors';
import type { Operation, PartId, Plane, Vec3 } from '../../geometry/types';
import { addOperation, batch, insertOperationAfter, removeOperation, updateOperation, type Command } from '../../store/commands';
import { dispatch, getDoc } from '../../store/history';
import { newId } from '../../store/project';
import { toBufferGeometry } from '../../store/sync';
import { setUI, toast, useUI, type CutDraft } from '../../store/ui';

const Z = new Vector3(0, 0, 1);

/** Gizmo matrix for a plane (rotation that maps +Z onto the normal). */
export function planeMatrix(plane: Plane): Matrix4 {
  const q = new Quaternion().setFromUnitVectors(Z, new Vector3(...plane.normal).normalize());
  return new Matrix4().compose(new Vector3(...plane.origin), q, new Vector3(1, 1, 1));
}

export function planeFromMatrix(m: Matrix4): Plane {
  const pos = new Vector3(), q = new Quaternion(), s = new Vector3();
  m.decompose(pos, q, s);
  const n = Z.clone().applyQuaternion(q).normalize();
  return { origin: pos.toArray() as Vec3, normal: n.toArray() as Vec3 };
}

export function partBox(id: PartId): Box3 | null {
  const part = useUI.getState().parts.find((p) => p.id === id);
  if (!part) return null;
  part.geometry.computeBoundingBox();
  return part.geometry.boundingBox!.clone();
}

function connectorDefaults() {
  const doc = getDoc();
  return { ...defaultConnectorParams(doc.technology), clearance: doc.clearance[doc.technology] };
}

/** Enters the cut tool on a part (selection, or the only part). */
export function startCut(partId?: PartId) {
  const { parts, selection } = useUI.getState();
  const doc = getDoc();
  const visible = parts.filter((p) => doc.partMeta[p.id]?.visible !== false);
  const id = partId ?? selection ?? (visible.length === 1 ? visible[0].id : null);
  if (!id) {
    toast('info', 'Selecione uma parte para cortar', 'Clique numa parte no viewport ou na lista de partes.');
    return;
  }
  if (doc.partMeta[id]?.locked) {
    toast('warning', 'Parte travada', 'Destrave a parte na lista para cortá-la.');
    return;
  }
  const box = partBox(id);
  if (!box) return;
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const draft: CutDraft = {
    target: id,
    plane: { origin: center.toArray() as Vec3, normal: [0, 0, 1] },
    bounded: false,
    radius: Math.max(size.x, size.y, size.z) * 0.3,
    connector: { enabled: true, type: 'pin', params: connectorDefaults() },
  };
  setUI({ tool: 'cut', draft, selection: id, connectorEdit: null });
}

/** Re-opens an existing cut for editing (later operations recompute on commit). */
export async function editCut(opId: string) {
  const doc = getDoc();
  const op = doc.operations.find((o) => o.id === opId);
  if (!op || op.kind !== 'cut-plane') return;
  const connector = doc.operations.find((o): o is Extract<Operation, { kind: 'connector' }> => o.kind === 'connector' && o.joint === opId);
  const mesh = await geometry().partDisplayBefore(opId, op.target);
  if (!mesh) {
    toast('error', 'Não foi possível editar este corte', 'A parte original não existe mais.');
    return;
  }
  const previewGeometry = toBufferGeometry(mesh);
  const size = previewGeometry.boundingBox!.getSize(new Vector3());
  useUI.getState().draft?.previewGeometry?.dispose();
  setUI({
    tool: 'cut',
    connectorEdit: null,
    selection: null,
    draft: {
      target: op.target,
      plane: op.plane,
      bounded: !!op.bounded,
      radius: op.bounded?.radius ?? Math.max(size.x, size.y, size.z) * 0.3,
      connector: connector
        ? { enabled: true, type: connector.type, params: connector.params }
        : { enabled: false, type: 'pin', params: connectorDefaults() },
      editingOpId: opId,
      connectorOpId: connector?.id,
      previewGeometry,
    },
  });
}

export function updateDraft(patch: Partial<CutDraft>) {
  const draft = useUI.getState().draft;
  if (draft) setUI({ draft: { ...draft, ...patch } });
}

export function cancelCut() {
  useUI.getState().draft?.previewGeometry?.dispose();
  setUI({ draft: null, tool: 'select' });
}

export function commitCut() {
  const draft = useUI.getState().draft;
  if (!draft) return;
  const doc = getDoc();
  const editing = draft.editingOpId;
  const cutId = editing ?? newId('c');
  const cut: Operation = {
    kind: 'cut-plane',
    id: cutId,
    target: draft.target,
    plane: draft.plane,
    ...(draft.bounded ? { bounded: { center: draft.plane.origin, radius: draft.radius } } : {}),
  };
  const cmds: Command[] = [editing ? updateOperation(cut, 'Editar corte') : addOperation(cut, 'Corte por plano')];
  const c = draft.connector;
  if (c.enabled) {
    const op: Operation = { kind: 'connector', id: draft.connectorOpId ?? newId('k'), joint: cutId, type: c.type, params: c.params };
    cmds.push(draft.connectorOpId ? updateOperation(op, 'Editar encaixe') : insertOperationAfter(cutId, op, 'Encaixe'));
  } else if (draft.connectorOpId) {
    cmds.push(removeOperation(draft.connectorOpId, 'Remover encaixe'));
  }
  const n = doc.operations.filter((o) => o.kind === 'cut-plane').length + (editing ? 0 : 1);
  dispatch(batch(editing ? 'Editar corte' : `Corte ${n}${c.enabled ? ' + encaixe' : ''}`, cmds));
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
  const [x, y, z] = draft.plane.normal;
  updateDraft({ plane: { ...draft.plane, normal: [-x, -y, -z] } });
}

/** Offset of the plane along its normal relative to the target's centre. */
export function draftOffsetRange(draft: CutDraft) {
  const g = draft.previewGeometry ?? useUI.getState().parts.find((p) => p.id === draft.target)?.geometry;
  if (!g) return { min: -50, max: 50, center: new Vector3() };
  g.computeBoundingSphere();
  const s = g.boundingSphere!;
  return { min: -s.radius, max: s.radius, center: s.center.clone() };
}

export function editConnector(opId: string) {
  cancelCut();
  setUI({ connectorEdit: opId, selection: null });
}
