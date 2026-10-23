import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Plane, Vec3 } from '../../geometry/types';

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
