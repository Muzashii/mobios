import { Box3, Vector3 } from 'three';
import type { ViewPart } from '../../store/ui';

/**
 * Exploded-view offsets: each part moves away from the assembly centre,
 * proportionally to its distance (keeps neighbours ordered, never collapses).
 */
export function explodeOffsets(parts: ViewPart[], amount: number): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  if (amount <= 0 || parts.length < 2) {
    for (const p of parts) out.set(p.id, new Vector3());
    return out;
  }
  const all = new Box3();
  const centers = new Map<string, Vector3>();
  for (const p of parts) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    const b = p.geometry.boundingBox!;
    all.union(b);
    centers.set(p.id, b.getCenter(new Vector3()));
  }
  const c = all.getCenter(new Vector3());
  const size = all.getSize(new Vector3()).length();
  for (const p of parts) {
    const d = centers.get(p.id)!.clone().sub(c);
    // Small parts near the centre (e.g. loose pins) still get pushed a little.
    const minPush = d.lengthSq() > 1e-6 ? d.clone().normalize().multiplyScalar(size * 0.08) : new Vector3(0, 0, size * 0.08);
    out.set(p.id, d.multiplyScalar(1.1).add(minPush).multiplyScalar(amount));
  }
  return out;
}
