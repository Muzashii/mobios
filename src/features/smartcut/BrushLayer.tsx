import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import { Matrix4, type InstancedMesh, type Mesh } from 'three';
import { useUI } from '../../store/ui';
import { ACCENT } from '../../ui/tokens';
import { brushCursor } from './brush';

const MAX_DABS = 4000;
const m = new Matrix4();

/** Painted region (translucent dabs) and the brush cursor. */
export function BrushLayer() {
  const brush = useUI((s) => s.brush);
  const active = useUI((s) => s.tool === 'brush');
  const dabs = useRef<InstancedMesh>(null);
  const cursor = useRef<Mesh>(null);

  useLayoutEffect(() => {
    const mesh = dabs.current;
    if (!mesh) return;
    const n = Math.min(brush.seeds.length, MAX_DABS);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = brush.seeds[i];
      m.makeScale(brush.radius, brush.radius, brush.radius).setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }, [brush]);

  useFrame(() => {
    const c = cursor.current;
    if (!c) return;
    c.visible = active && !!brushCursor.point;
    if (brushCursor.point) c.position.set(...brushCursor.point);
    c.scale.setScalar(brush.radius);
  });

  return (
    <group>
      <instancedMesh ref={dabs} args={[undefined, undefined, MAX_DABS]} frustumCulled={false} renderOrder={3}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <mesh ref={cursor} renderOrder={4}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={ACCENT} wireframe transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  );
}
