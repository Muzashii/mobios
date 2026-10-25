import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import { Matrix4, type InstancedMesh, type Mesh, type MeshBasicMaterial } from 'three';
import { useUI } from '../../store/ui';
import { ACCENT, NEG_SEED } from '../../ui/tokens';
import { Loops } from '../viewport/RegionPreview';
import { brushCursor } from './brush';

const MAX_DABS = 4000;
const m = new Matrix4();

/** Painted region (translucent dabs) and the brush cursor. */
export function BrushLayer() {
  const brush = useUI((s) => s.brush);
  // Only the free brush draws dabs and a cursor; picking detected parts needs neither.
  const active = useUI((s) => s.tool === 'brush' && s.brushAdvanced);
  const hover = useUI((s) => (s.tool === 'brush' ? s.hover : null));
  const dabs = useRef<InstancedMesh>(null);
  const negDabs = useRef<InstancedMesh>(null);
  const cursor = useRef<Mesh>(null);
  const cursorMat = useRef<MeshBasicMaterial>(null);

  useLayoutEffect(() => {
    for (const [mesh, list] of [[dabs.current, brush.seeds], [negDabs.current, brush.negSeeds]] as const) {
      if (!mesh) continue;
      const n = Math.min(list.length, MAX_DABS);
      for (let i = 0; i < n; i++) {
        const [x, y, z] = list[i];
        m.makeScale(brush.radius, brush.radius, brush.radius).setPosition(x, y, z);
        mesh.setMatrixAt(i, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [brush]);

  useFrame(() => {
    const c = cursor.current;
    if (!c) return;
    c.visible = active && !!brushCursor.point;
    if (brushCursor.point) c.position.set(...brushCursor.point);
    c.scale.setScalar(brush.radius);
    cursorMat.current?.color.set(brushCursor.negative ? NEG_SEED : ACCENT);
  });

  return (
    <group>
      {/* Hover: the whole part SmartCut would separate here lights up. */}
      {hover && active && !brush.seeds.length && (
        <group>
          <mesh geometry={hover.geometry} renderOrder={2}>
            <meshBasicMaterial color={ACCENT} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
          </mesh>
          <Loops loops={hover.loops} />
        </group>
      )}
      <instancedMesh ref={dabs} args={[undefined, undefined, MAX_DABS]} frustumCulled={false} renderOrder={3}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={negDabs} args={[undefined, undefined, MAX_DABS]} frustumCulled={false} renderOrder={3}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={NEG_SEED} transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <mesh ref={cursor} renderOrder={4}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial ref={cursorMat} color={ACCENT} wireframe transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  );
}
