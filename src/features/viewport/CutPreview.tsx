import { Line, PivotControls } from '@react-three/drei';
import { useMemo } from 'react';
import { BackSide, DoubleSide, Plane as ThreePlane, Vector3, type Matrix4 } from 'three';
import { useUI, type CutDraft } from '../../store/ui';
import { ACCENT, CUT_A, CUT_B } from '../../ui/tokens';
import { planeFromMatrix, planeMatrix, updateDraft } from '../cut/cutActions';

/**
 * Live "ghost" preview of a cut: the target is clipped on the GPU into both sides
 * (B slightly pulled apart along the normal) — instant, no geometry work.
 * Back faces render in the accent colour, which reads as a filled cut face.
 */
export function CutPreview({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  const geometry = draft.previewGeometry ?? part?.geometry;

  const { size, n, gap, clipA, clipB, matrix } = useMemo(() => {
    const g = geometry!;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r = g.boundingSphere!.radius;
    const nv = new Vector3(...draft.plane.normal).normalize();
    const o = new Vector3(...draft.plane.origin);
    const d = nv.dot(o);
    return {
      size: r * 2.4,
      n: nv,
      gap: r * 0.06,
      // three.js keeps points where n·p + c >= 0.
      clipA: [new ThreePlane(nv.clone().negate(), d)],
      clipB: [new ThreePlane(nv.clone(), -d)],
      matrix: planeMatrix(draft.plane),
    };
  }, [geometry, draft.plane]);

  if (!geometry) return null;
  const offsetB = n.clone().multiplyScalar(gap);
  const half = size / 2;
  const border: [number, number, number][] = [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0], [-half, -half, 0]];

  const onDrag = (local: Matrix4) => updateDraft({ plane: planeFromMatrix(local) });

  return (
    <group>
      {/* Side A (opposite to the normal) */}
      <mesh geometry={geometry}>
        <meshStandardMaterial color={CUT_A} roughness={0.6} clippingPlanes={clipA} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={ACCENT} side={BackSide} clippingPlanes={clipA} />
      </mesh>
      {/* Side B (normal side), pulled apart */}
      <group position={offsetB}>
        <mesh geometry={geometry}>
          <meshStandardMaterial color={CUT_B} roughness={0.55} transparent opacity={0.92} clippingPlanes={clipB.map((p) => p.clone().translate(offsetB))} />
        </mesh>
        <mesh geometry={geometry}>
          <meshBasicMaterial color={ACCENT} side={BackSide} clippingPlanes={clipB.map((p) => p.clone().translate(offsetB))} />
        </mesh>
      </group>

      <PivotControls
        matrix={matrix}
        autoTransform={false}
        onDrag={onDrag}
        disableScaling
        depthTest={false}
        fixed
        scale={90}
        lineWidth={2.5}
        axisColors={['#ff5a5f', '#3dd68c', '#3a86ff']}
        hoveredColor={ACCENT}
        annotations
      >
        <mesh renderOrder={2}>
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.1} side={DoubleSide} depthWrite={false} />
        </mesh>
        <Line points={border} color={ACCENT} lineWidth={1.5} transparent opacity={0.8} />
        {/* Normal arrow: B side */}
        <Line points={[[0, 0, 0], [0, 0, half * 0.35]]} color={ACCENT} lineWidth={2} />
        {draft.bounded && (
          <mesh>
            <sphereGeometry args={[draft.radius, 48, 24]} />
            <meshBasicMaterial color={ACCENT} wireframe transparent opacity={0.25} depthWrite={false} />
          </mesh>
        )}
      </PivotControls>
    </group>
  );
}
