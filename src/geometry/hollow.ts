import type { Manifold } from 'manifold-3d';
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { dropSlivers } from './cut';
import { manifoldToMeshData } from './repair';
import type { Vec3 } from './types';
import type { Wasm } from './wasm';

export interface HollowResult {
  part: Manifold;
  drains: number;
  warnings: string[];
  /** Resin saved (mm³). */
  removed: number;
}

/**
 * Resin hollowing: keeps a shell of `wall` mm and drills drain holes at the lowest points
 * of the cavity (−Z, as printed). The inner surface is a level set of the signed distance
 * to the mesh (BVH-accelerated), since exact 3D offsets (Minkowski) are far too slow.
 */
export function hollowPart(wasm: Wasm, part: Manifold, wall: number, drainDiameter: number, drainCount: number): HollowResult {
  const warnings: string[] = [];
  const mesh = manifoldToMeshData(part);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  const bvh = new MeshBVH(g);

  const box = part.boundingBox();
  const size = [0, 1, 2].map((k) => box.max[k] - box.min[k]);
  const diag = Math.hypot(size[0], size[1], size[2]);
  if (Math.min(...size) < wall * 2 + 1) throw new Error(`A peça é fina demais para uma parede de ${wall} mm.`);
  // Grid edge: fine enough for the wall, coarse enough to stay interactive (≤ ~70³ samples).
  const edge = Math.max(wall * 0.6, diag / 70);

  const ray = new Ray();
  const p = new Vector3();
  const dir = new Vector3(1, 0.000123, 0.000271).normalize(); // avoid grazing edges
  const isInside = (q: Vector3) => {
    ray.set(q, dir);
    return bvh.raycast(ray, DoubleSide).length % 2 === 1;
  };
  const sdf = (pt: Vec3) => {
    p.set(pt[0], pt[1], pt[2]);
    if (!isInside(p)) return -wall;
    const hit = bvh.closestPointToPoint(p, undefined, 0, wall * 2);
    // Farther than 2·wall from the surface: comfortably inside the cavity.
    return hit ? hit.distance - wall : wall;
  };
  const inner = wasm.Manifold.levelSet(sdf, { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, edge, 0, edge * 0.05);
  g.dispose();
  if (inner.isEmpty() || inner.volume() < 1) {
    inner.delete();
    throw new Error('Não sobrou cavidade: reduza a espessura da parede.');
  }

  let shell = dropSlivers(wasm, part.subtract(inner));
  let drains = 0;
  if (drainCount > 0) {
    // Lowest points of the cavity, spread apart.
    const im = manifoldToMeshData(inner);
    const verts: Vec3[] = [];
    for (let i = 0; i < im.positions.length; i += 3) verts.push([im.positions[i], im.positions[i + 1], im.positions[i + 2]]);
    verts.sort((a, b) => a[2] - b[2]);
    const chosen: Vec3[] = [];
    const spacing = Math.max(drainDiameter * 4, diag * 0.15);
    for (const v of verts) {
      if (chosen.length >= drainCount) break;
      if (chosen.every((c) => Math.hypot(c[0] - v[0], c[1] - v[1]) > spacing)) chosen.push(v);
    }
    const holes = chosen.map((c) => {
      const h = c[2] - box.min[2] + 2;
      return wasm.Manifold.cylinder(h + 1, drainDiameter / 2, drainDiameter / 2, 24).translate([c[0], c[1], box.min[2] - 2]);
    });
    if (holes.length) {
      const all = wasm.Manifold.union(holes);
      const drilled = dropSlivers(wasm, shell.subtract(all));
      shell.delete();
      shell = drilled;
      all.delete();
      holes.forEach((h) => h.delete());
      drains = chosen.length;
    }
  }
  if (drains === 0) warnings.push('Sem furos de drenagem: a resina fica presa e a cavidade faz efeito ventosa na impressão.');
  const removed = part.volume() - shell.volume();
  inner.delete();
  return { part: shell, drains, warnings, removed };
}
