import type { ThreeEvent } from '@react-three/fiber';
import type { CameraControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry } from 'three';
import { geometry } from '../../geometry/client';
import type { Vec3 } from '../../geometry/types';
import { setUI, useUI } from '../../store/ui';
import { suggestFromBrush } from '../cut/cutActions';

/** Pointer state of an ongoing brush stroke (not React state: updated at pointer rate). */
const stroke = { active: false, negative: false, controls: null as CameraControls | null, x: 0, y: 0, moved: 0, added: 0 };
export const brushCursor = { point: null as Vec3 | null, part: null as string | null, negative: false };

function addSeed(partId: string, p: Vec3, negative: boolean) {
  const { brush } = useUI.getState();
  const same = brush.target === partId;
  const list = negative ? (same ? brush.negSeeds : []) : same ? brush.seeds : [];
  const last = list[list.length - 1];
  // Space dabs at ~40% of the radius: continuous coverage, few points.
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < brush.radius * 0.4) return;
  stroke.added++;
  const next = [...list, p];
  setUI({
    brush: {
      ...brush,
      target: partId,
      seeds: negative ? (same ? brush.seeds : []) : next,
      negSeeds: negative ? next : same ? brush.negSeeds : [],
    },
    hover: null,
  });
}

/** Hit point in the part's own frame (parts may be offset by the exploded view). */
const localPoint = (e: ThreeEvent<PointerEvent>) => e.point.clone().sub(e.object.position).toArray() as Vec3;

export function brushDown(e: ThreeEvent<PointerEvent>, partId: string, controls: unknown) {
  if (e.button !== 0) return;
  e.stopPropagation();
  stroke.active = true;
  stroke.negative = e.nativeEvent.shiftKey;
  stroke.x = e.nativeEvent.clientX;
  stroke.y = e.nativeEvent.clientY;
  stroke.moved = 0;
  stroke.added = 0;
  stroke.controls = (controls as CameraControls | null) ?? null;
  if (stroke.controls) stroke.controls.enabled = false;
  addSeed(partId, localPoint(e), stroke.negative);
  window.addEventListener('pointerup', brushUp, { once: true });
}

export function brushMove(e: ThreeEvent<PointerEvent>, partId: string) {
  brushCursor.point = localPoint(e);
  brushCursor.part = partId;
  brushCursor.negative = e.nativeEvent.shiftKey;
  if (!stroke.active) {
    scheduleHover(partId, brushCursor.point);
    return;
  }
  e.stopPropagation();
  stroke.moved = Math.max(stroke.moved, Math.hypot(e.nativeEvent.clientX - stroke.x, e.nativeEvent.clientY - stroke.y));
  addSeed(partId, brushCursor.point, stroke.negative);
}

export function brushLeave(partId: string) {
  if (brushCursor.part === partId) brushCursor.point = null;
  clearTimeout(hoverTimer);
}

function brushUp() {
  const click = stroke.moved < 5 && !stroke.negative;
  stroke.active = false;
  if (stroke.controls) stroke.controls.enabled = true;
  stroke.controls = null;
  // A plain click (no drag) cuts the part under the cursor right away: hover → click → Enter.
  if (click && !useUI.getState().busy) void suggestFromBrush();
}

// --- Hover: the part SmartCut would separate, computed on the cached proxy in the worker. ---

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let hoverSeq = 0;

function scheduleHover(partId: string, point: Vec3) {
  clearTimeout(hoverTimer);
  const { busy, hover } = useUI.getState();
  if (busy) return;
  // Still inside the highlighted part: keep it (no flicker, no work).
  if (hover?.part === partId && insideSoup(hover.geometry, point)) return;
  hoverTimer = setTimeout(() => void runHover(partId, point), 110);
}

async function runHover(partId: string, point: Vec3) {
  const seq = ++hoverSeq;
  const { brush } = useUI.getState();
  const h = await geometry().smartHover(partId, point, brush.radius);
  if (seq !== hoverSeq || useUI.getState().tool !== 'brush' || stroke.active) return;
  useUI.getState().hover?.geometry.dispose();
  if (!h) {
    setUI({ hover: null });
    return;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(h.preview, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  setUI({ hover: { part: partId, geometry: g, loops: h.loops, name: h.name, confidence: h.confidence } });
}

/** Is the point on (near) one of the highlighted triangles? Bounding box first, then vertices. */
function insideSoup(g: BufferGeometry, p: Vec3) {
  const box = g.boundingBox;
  if (!box || p[0] < box.min.x || p[1] < box.min.y || p[2] < box.min.z || p[0] > box.max.x || p[1] > box.max.y || p[2] > box.max.z) return false;
  const a = g.getAttribute('position').array as Float32Array;
  const r2 = useUI.getState().brush.radius ** 2;
  for (let i = 0; i < a.length; i += 3) if ((a[i] - p[0]) ** 2 + (a[i + 1] - p[1]) ** 2 + (a[i + 2] - p[2]) ** 2 < r2) return true;
  return false;
}
