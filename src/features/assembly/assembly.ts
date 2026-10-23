import { Box3, Vector3 } from 'three';
import type { JointInfo } from '../../geometry/types';
import type { ViewPart } from '../../store/ui';

/**
 * Assembly simulation: every part starts pulled off along its joints' insertion
 * directions, then the joints close one by one (last cut first, so sub-assemblies
 * form before they join the main body). `progress` goes 0 → 1.
 */
export function assemblyOffsets(parts: ViewPart[], joints: JointInfo[], progress: number): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  const box = new Box3();
  for (const p of parts) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const travel = Math.max(10, box.getSize(new Vector3()).length() * 0.3);
  const order = [...joints].reverse();
  const n = Math.max(1, order.length);
  const stage = (k: number) => {
    const t = Math.min(1, Math.max(0, progress * n - k));
    return t * t * (3 - 2 * t); // smoothstep
  };
  for (const p of parts) {
    const off = new Vector3();
    order.forEach((j, k) => {
      const remaining = 1 - stage(k);
      if (remaining <= 0) return;
      const dir = new Vector3(...j.insertDir).normalize();
      if (p.lineage.includes(`${j.id}.b`)) off.addScaledVector(dir, travel * remaining);
      else if (p.lineage.includes(`${j.id}.pins`)) off.addScaledVector(dir, travel * 0.5 * remaining);
    });
    out.set(p.id, off);
  }
  return out;
}
