import { Line, PivotControls } from '@react-three/drei';
import { useMemo } from 'react';
import { profileHeight } from '../../geometry/cutters';
import { planeFrame } from '../../geometry/math';
import type { Vec3 } from '../../geometry/types';
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

  // Profiled joint: draw the profile across the plane (the clipping preview shows the mid plane).
  const profileLines = useMemo(() => {
    if (!draft.profile || draft.profile.amplitude <= 0) return [];
    const { u, v, n, origin } = planeFrame(draft.plane);
    const half = size / 2;
    const samples = draft.profile.kind === 'zigzag' ? Math.ceil(size / (draft.profile.period / 2)) : 160;
    return [-0.5, 0, 0.5].map((k) => {
      const pts: Vec3[] = [];
      for (let i = 0; i <= samples; i++) {
        const x = -half + (size * i) / samples;
        const h = profileHeight(draft.profile!, x);
        pts.push([0, 1, 2].map((j) => origin[j] + u[j] * x + v[j] * k * size + n[j] * h) as Vec3);
      }
      return pts;
    });
  }, [draft.profile, draft.plane, size]);

  if (!geometry) return null;
  const offsetB = n.clone().multiplyScalar(gap);
  const half = size / 2;
  const border: [number, number, number][] = [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0], [-half, -half, 0]];

  const onDrag = (local: Matrix4) => updateDraft({ plane: planeFromMatrix(local) });

  // A bounded cut only separates islands inside the sphere; a half-space split preview
  // would paint the whole body as B. Show the part whole and let the sphere tell the story.
  if (draft.bounded && !(draft.profile && draft.profile.amplitude > 0)) {
    return (
      <group>
        <mesh geometry={geometry}>
          <meshStandardMaterial color={CUT_A} roughness={0.6} transparent opacity={0.9} />
        </mesh>
        {draft.smartRing && draft.smartRing.length > 0 && (
          <points renderOrder={5}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[new Float32Array(draft.smartRing.flat()), 3]} />
            </bufferGeometry>
            <pointsMaterial color="#ffffff" size={4} sizeAttenuation={false} depthTest={false} />
          </points>
        )}
        <PivotControls matrix={matrix} autoTransform={false} onDrag={onDrag} disableScaling depthTest={false} fixed scale={90} lineWidth={2.5} axisColors={['#ff5a5f', '#3dd68c', '#3a86ff']} hoveredColor={ACCENT}>
          <mesh renderOrder={2}>
            <circleGeometry args={[draft.radius, 64]} />
            <meshBasicMaterial color={ACCENT} transparent opacity={0.28} side={DoubleSide} depthWrite={false} depthTest={false} />
          </mesh>
          <Line points={[[0, 0, 0], [0, 0, draft.radius * 0.8]]} color={ACCENT} lineWidth={2} depthTest={false} />
          <mesh>
            <sphereGeometry args={[draft.radius, 48, 24]} />
            <meshBasicMaterial color={ACCENT} wireframe transparent opacity={0.22} depthWrite={false} />
          </mesh>
        </PivotControls>
      </group>
    );
  }

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

      {profileLines.map((pts, i) => (
        <Line key={i} points={pts} color={ACCENT} lineWidth={2.5} depthTest={false} />
      ))}
      {draft.smartRing && draft.smartRing.length > 0 && (
        <points renderOrder={5}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(draft.smartRing.flat()), 3]} />
          </bufferGeometry>
          <pointsMaterial color="#ffffff" size={4} sizeAttenuation={false} depthTest={false} />
        </points>
      )}

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
