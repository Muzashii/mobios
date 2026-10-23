import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import type { IssueMarkers } from '../../geometry/types';
import { useUI } from '../../store/ui';
import { XRAY_COLORS } from '../../ui/tokens';

function markerGeometry(m: IssueMarkers) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  return g;
}

/**
 * Raio-X heatmap: the raw imported mesh (as it is in the file) with every problem painted on
 * it — open edges red, non-manifold magenta, inverted faces purple, self-intersections orange,
 * thin walls yellow… "Mostrar" isolates one issue.
 */
export function XRayView() {
  const x = useUI((s) => s.xray);
  const report = x?.reports[x.index];
  const mesh = useMemo(() => {
    if (!report) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(report.preview.positions, 3));
    g.setAttribute('normal', new BufferAttribute(report.preview.normals, 3));
    return g;
  }, [report]);
  const markers = useMemo(
    () => (report ? report.issues.flatMap((issue, i) => (issue.markers ? [{ i, kind: issue.kind, type: issue.markers.type, g: markerGeometry(issue.markers) }] : [])) : []),
    [report],
  );
  useEffect(() => () => {
    mesh?.dispose();
    markers.forEach((m) => m.g.dispose());
  }, [mesh, markers]);
  if (!x || !mesh) return null;
  return (
    <group>
      {/* DoubleSide: inverted faces and holes still read as a surface. */}
      <mesh geometry={mesh}>
        <meshStandardMaterial color="#c9c6bf" roughness={0.7} side={DoubleSide} transparent opacity={x.focusIssue !== null ? 0.45 : 0.85} />
      </mesh>
      {markers.map((m) => {
        if (x.focusIssue !== null && x.focusIssue !== m.i) return null;
        const color = XRAY_COLORS[m.kind] ?? '#ffffff';
        if (m.type === 'edges') return <lineSegments key={m.i} geometry={m.g} renderOrder={5}><lineBasicMaterial color={color} depthTest={false} /></lineSegments>;
        if (m.type === 'points') return <points key={m.i} geometry={m.g} renderOrder={5}><pointsMaterial color={color} size={7} sizeAttenuation={false} depthTest={false} /></points>;
        return (
          <mesh key={m.i} geometry={m.g} renderOrder={4}>
            <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={0.85} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
          </mesh>
        );
      })}
    </group>
  );
}
