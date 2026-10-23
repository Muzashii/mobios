import { useRef, useState } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { smoothStroke } from '../../geometry/cutters';
import type { StrokeFrame, Vec2, Vec3 } from '../../geometry/types';
import { useUI } from '../../store/ui';
import { finishStroke, partBox } from './cutActions';
import { viewportRefs } from '../viewport/viewportRefs';

/**
 * Free-hand cut: the user draws a line across the part on screen. The stroke is
 * projected onto a view-aligned plane through the part and later extruded along the
 * view direction into a cutting surface (the left side of the stroke becomes B).
 */
export function StrokeOverlay() {
  const active = useUI((s) => s.tool === 'draw');
  const [pts, setPts] = useState<[number, number][]>([]);
  const drawing = useRef(false);
  if (!active) return null;

  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  const finish = (screen: [number, number][]) => {
    const { camera, canvas } = viewportRefs;
    const target = useUI.getState().selection;
    const box = target ? partBox(target) : null;
    if (!camera || !canvas || !box || screen.length < 2) return;
    const c = box.getCenter(new Vector3());
    const n = camera.getWorldDirection(new Vector3()).negate();
    const u = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const v = n.clone().cross(u).normalize();
    const plane = new Plane().setFromNormalAndCoplanarPoint(n, c);
    const ray = new Raycaster();
    const rect = canvas.getBoundingClientRect();
    const out: Vec2[] = [];
    for (const [x, y] of screen) {
      ray.setFromCamera(new Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), camera);
      const hit = ray.ray.intersectPlane(plane, new Vector3());
      if (!hit) continue;
      const d = hit.sub(c);
      out.push([d.dot(u), d.dot(v)]);
    }
    const frame: StrokeFrame = {
      origin: c.toArray() as Vec3,
      u: u.toArray() as Vec3,
      v: v.toArray() as Vec3,
      n: n.toArray() as Vec3,
    };
    const size = box.getSize(new Vector3()).length();
    finishStroke(frame, smoothStroke(out, 2, size / 200));
  };

  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drawing.current = true;
        setPts([local(e)]);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const p = local(e);
        setPts((prev) => {
          const last = prev[prev.length - 1];
          return last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 3 ? prev : [...prev, p];
        });
      }}
      onPointerUp={() => {
        drawing.current = false;
        finish(pts);
        setPts([]);
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
