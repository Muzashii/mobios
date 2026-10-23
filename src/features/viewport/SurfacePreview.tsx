import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, Vector3 } from 'three';
import type { Vec3 } from '../../geometry/types';
import { useUI, type CutDraft } from '../../store/ui';
import { ACCENT, CUT_A } from '../../ui/tokens';

/** Preview of a free-hand cut: the target, the extruded stroke surface and the B-side arrows. */
export function SurfacePreview({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  const geometry = draft.previewGeometry ?? part?.geometry;
  const s = draft.surface!;

  const { ribbon, arrows, stroke } = useMemo(() => {
    const g = geometry!;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const depth = g.boundingSphere!.radius * 1.2;
    const o = new Vector3(...s.frame.origin), u = new Vector3(...s.frame.u), v = new Vector3(...s.frame.v), n = new Vector3(...s.frame.n);
    const world = s.points.map(([x, y]) => o.clone().addScaledVector(u, x).addScaledVector(v, y));
    const pos = new Float32Array(world.length * 6);
    world.forEach((w, i) => {
      w.clone().addScaledVector(n, depth).toArray(pos, i * 6);
      w.clone().addScaledVector(n, -depth).toArray(pos, i * 6 + 3);
    });
    const idx: number[] = [];
    for (let i = 0; i + 1 < world.length; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(pos, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();

    // Arrows point to the side that becomes part B (left of the stroke, unless flipped).
    const out: [Vec3, Vec3][] = [];
    const len = g.boundingSphere!.radius * 0.18;
    for (const i of [0.25, 0.5, 0.75].map((f) => Math.floor(f * (world.length - 1)))) {
      const a = world[Math.max(0, i - 1)], b = world[Math.min(world.length - 1, i + 1)];
      const dir = b.clone().sub(a).normalize();
      const left = n.clone().cross(dir).normalize().multiplyScalar(s.flip ? -len : len);
      out.push([world[i].toArray() as Vec3, world[i].clone().add(left).toArray() as Vec3]);
    }
    return { ribbon: rg, arrows: out, stroke: world.map((w) => w.toArray() as Vec3) };
  }, [geometry, s]);

  if (!geometry) return null;
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={CUT_A} roughness={0.6} transparent opacity={0.85} />
      </mesh>
      <mesh geometry={ribbon} renderOrder={2}>
        <meshBasicMaterial color={ACCENT} transparent opacity={0.22} side={DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={stroke} color={ACCENT} lineWidth={2} depthTest={false} />
      {arrows.map(([a, b], i) => (
        <Line key={i} points={[a, b]} color={ACCENT} lineWidth={3} depthTest={false} />
      ))}
    </group>
  );
}
