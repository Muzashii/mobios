import type { ThreeEvent } from '@react-three/fiber';
import type { CameraControls } from '@react-three/drei';
import type { Vec3 } from '../../geometry/types';
import { setUI, useUI } from '../../store/ui';

/** Pointer state of an ongoing brush stroke (not React state: updated at pointer rate). */
const stroke = { active: false, controls: null as CameraControls | null };
export const brushCursor = { point: null as Vec3 | null, part: null as string | null };

function addSeed(partId: string, p: Vec3) {
  const { brush } = useUI.getState();
  const seeds = brush.target === partId ? brush.seeds : [];
  const last = seeds[seeds.length - 1];
  // Space dabs at ~40% of the radius: continuous coverage, few points.
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < brush.radius * 0.4) return;
  setUI({ brush: { ...brush, target: partId, seeds: [...seeds, p] } });
}

/** Hit point in the part's own frame (parts may be offset by the exploded view). */
const localPoint = (e: ThreeEvent<PointerEvent>) => e.point.clone().sub(e.object.position).toArray() as Vec3;

export function brushDown(e: ThreeEvent<PointerEvent>, partId: string, controls: unknown) {
  if (e.button !== 0) return;
  e.stopPropagation();
  stroke.active = true;
  stroke.controls = (controls as CameraControls | null) ?? null;
  if (stroke.controls) stroke.controls.enabled = false;
  addSeed(partId, localPoint(e));
  window.addEventListener('pointerup', brushUp, { once: true });
}

export function brushMove(e: ThreeEvent<PointerEvent>, partId: string) {
  brushCursor.point = localPoint(e);
  brushCursor.part = partId;
  if (!stroke.active) return;
  e.stopPropagation();
  addSeed(partId, brushCursor.point);
}

function brushUp() {
  stroke.active = false;
  if (stroke.controls) stroke.controls.enabled = true;
  stroke.controls = null;
}
