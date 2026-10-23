import type { JointInfo } from '../../geometry/types';

/** Joint currently closing in the assembly simulation (last cut assembles first). */
export function activeJoint(joints: JointInfo[], progress: number): JointInfo | null {
  if (!joints.length || progress >= 1) return null;
  const order = [...joints].reverse();
  return order[Math.min(order.length - 1, Math.floor(progress * order.length))];
}
