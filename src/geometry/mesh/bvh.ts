import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData, Vec3 } from '../types';

/**
 * BVH over an indexed mesh for ray queries in the worker (three-mesh-bvh needs no DOM).
 * `indirect` keeps the caller's triangle order, so face indices match the mesh.
 */
export class MeshQuery {
  readonly bvh: MeshBVH;
  readonly geometry: BufferGeometry;
  private ray = new Ray();

  constructor(mesh: MeshData) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    this.geometry = g;
    this.bvh = new MeshBVH(g, { indirect: true, targetLeafSize: 8 });
  }

  /** Distances of every surface crossing along the ray (sorted, > `near`). */
  hits(o: Vec3, d: Vec3, near = 1e-6, far = Infinity): { distance: number; face: number }[] {
    this.ray.origin.set(o[0], o[1], o[2]);
    this.ray.direction.set(d[0], d[1], d[2]).normalize();
    return this.bvh
      .raycast(this.ray, DoubleSide, near, far)
      .map((h) => ({ distance: h.distance, face: h.faceIndex ?? -1 }))
      .sort((a, b) => a.distance - b.distance);
  }

  first(o: Vec3, d: Vec3, near = 1e-6, far = Infinity): { distance: number; face: number } | null {
    this.ray.origin.set(o[0], o[1], o[2]);
    this.ray.direction.set(d[0], d[1], d[2]).normalize();
    const h = this.bvh.raycastFirst(this.ray, DoubleSide, near, far);
    return h ? { distance: h.distance, face: h.faceIndex ?? -1 } : null;
  }

  /** Closest surface point (and its face) to `p`. */
  closest(p: Vec3): { point: Vec3; distance: number; face: number } | null {
    const hit = this.bvh.closestPointToPoint(new Vector3(p[0], p[1], p[2]));
    if (!hit) return null;
    return { point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance, face: hit.faceIndex };
  }

  dispose() {
    this.geometry.dispose();
  }
}
