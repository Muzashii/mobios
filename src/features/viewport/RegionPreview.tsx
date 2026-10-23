import { Line } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import type { Vec3 } from '../../geometry/types';
import { useUI, type CutDraft } from '../../store/ui';
import { CUT_A, CUT_B } from '../../ui/tokens';

/** Triangle soup → geometry with flat normals (SmartCut previews). */
export function soupGeometry(soup: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(soup, 3));
  g.computeVertexNormals();
  return g;
}

/** Closed boundary loops of the separated part, drawn on top of everything. */
export function Loops({ loops, color = '#ffffff' }: { loops: Vec3[][]; color?: string }) {
  return (
    <>
      {loops.map((l, i) => (l.length > 2 ? <Line key={i} points={[...l, l[0]]} color={color} lineWidth={2.5} depthTest={false} renderOrder={6} /> : null))}
    </>
  );
}

/**
 * Preview of a SmartCut region cut: the part in A's colour with B (the piece that leaves)
 * highlighted. While the worker validates, the candidate's own region is shown; once the
 * dry-run is back, the real piece B (with its cap) replaces it.
 */
export function RegionPreview({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  const check = useUI((s) => s.cutCheck);
  const region = draft.region!;
  const candidate = region.candidates[region.index];
  const candidateGeo = useMemo(() => (candidate ? soupGeometry(candidate.preview) : null), [candidate]);
  useEffect(() => () => candidateGeo?.dispose(), [candidateGeo]);
  const geometry = draft.previewGeometry ?? part?.geometry;
  if (!geometry) return null;
  const fresh = check && !check.pending && check.result?.ok ? check.previewB : undefined;
  const highlight = fresh ?? candidateGeo;
  const loops = candidate && region.level === candidate.level ? candidate.loops : [];
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={CUT_A} roughness={0.6} />
      </mesh>
      {highlight && (
        <mesh geometry={highlight} renderOrder={2}>
          <meshStandardMaterial color={CUT_B} roughness={0.55} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} transparent opacity={fresh ? 1 : 0.85} />
        </mesh>
      )}
      <Loops loops={loops} />
      {draft.batch?.map((b, i) => {
        const c = b.candidates[b.index];
        return c ? <Loops key={i} loops={c.loops} color={CUT_B} /> : null;
      })}
    </group>
  );
}
