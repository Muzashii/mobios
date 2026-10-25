import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, type Mesh, type MeshStandardMaterial, type Vector3 } from 'three';
import { setPartMeta } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { focus, setUI, useUI, type ViewPart } from '../../store/ui';
import { ACCENT } from '../../ui/tokens';
import { partColor } from '../paint/colors';
import { brushDown, brushLeave, brushMove } from '../smartcut/brush';
import { pickDetectedPart } from '../cut/cutActions';
import { PartMapMesh } from './PartMapMesh';

const NO_EDITS = { names: {}, merged: {} };

const accent = new Color(ACCENT);

function PartMesh({ part, offset, color, selected, hovered, interactive }: { part: ViewPart; offset: Vector3; color: string; selected: boolean; hovered: boolean; interactive: boolean }) {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const busy = useUI((s) => s.busy);
  const tool = useUI((s) => s.tool);
  const controls = useThree((s) => s.controls);
  const brushing = tool === 'brush';

  useFrame(({ clock }) => {
    if (!mat.current) return;
    // SmartCut paints its own hover (the part under the cursor), so the whole-part glow stays off.
    const base = brushing ? 0 : selected ? 0.22 : hovered ? 0.12 : 0;
    // Non-blocking progress: parts breathe softly while the worker computes.
    const pulse = busy ? 0.06 + 0.06 * Math.sin(clock.elapsedTime * 6) : 0;
    mat.current.emissiveIntensity = base + pulse;
  });

  return (
    <mesh
      ref={mesh}
      geometry={part.geometry}
      position={offset}
      castShadow
      receiveShadow
      onPointerDown={interactive && brushing ? (e) => brushDown(e, part.id, controls) : undefined}
      onPointerMove={interactive && brushing ? (e) => brushMove(e, part.id) : undefined}
      onPointerOver={interactive ? (e) => (e.stopPropagation(), setUI({ hovered: part.id })) : undefined}
      onPointerOut={interactive ? () => { brushLeave(part.id); if (useUI.getState().hovered === part.id) setUI({ hovered: null }); } : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              const { tool } = useUI.getState();
              if (tool === 'brush') return;
              if (tool === 'paint') {
                const slot = useUI.getState().activeSlot;
                dispatch(setPartMeta(part.id, { slot }, `Pintar ${part.name}`));
                return;
              }
              setUI({ selection: part.id, connectorEdit: null });
            }
          : undefined
      }
      onDoubleClick={interactive ? (e) => (e.stopPropagation(), focus(part.id)) : undefined}
    >
      <meshStandardMaterial ref={mat} color={color} roughness={0.58} metalness={0.04} emissive={accent} emissiveIntensity={0} />
    </mesh>
  );
}

export function Parts({ offsets, hiddenId }: { offsets: Map<string, Vector3>; hiddenId?: string }) {
  const parts = useUI((s) => s.parts);
  const selection = useUI((s) => s.selection);
  const hovered = useUI((s) => s.hovered);
  const drafting = useUI((s) => !!s.draft);
  const doc = useHistory((s) => s.doc);
  const maps = useUI((s) => s.partMaps);
  const tool = useUI((s) => s.tool);
  const brushAdvanced = useUI((s) => s.brushAdvanced);
  const visible = useMemo(() => parts.filter((p) => doc.partMeta[p.id]?.visible !== false && p.id !== hiddenId), [parts, doc.partMeta, hiddenId]);
  return (
    <group>
      {visible.map((p) => {
        const interactive = !drafting && !doc.partMeta[p.id]?.locked;
        // Detected parts show while selecting; cutting, painting and the brush use the plain mesh.
        const edits = doc.partMaps?.[p.id];
        const map = maps[p.id];
        const ready = map?.status === 'ready' && map.version === p.version && map.result;
        // SmartCut: the detected part under the cursor lights up; a click cuts it off.
        if (tool === 'brush' && !brushAdvanced && ready && map.result)
          return (
            <PartMapMesh
              key={p.id}
              part={p}
              offset={offsets.get(p.id)!}
              result={map.result}
              edits={edits ?? NO_EDITS}
              interactive={interactive}
              mono={partColor(doc, p)}
              onPick={(point, group) => pickDetectedPart(p.id, point, group)}
            />
          );
        if (edits && tool === 'select' && ready && map.result)
          return <PartMapMesh key={p.id} part={p} offset={offsets.get(p.id)!} result={map.result} edits={edits} interactive={interactive} />;
        return (
          <PartMesh
            key={p.id}
            part={p}
            offset={offsets.get(p.id)!}
            color={partColor(doc, p)}
            selected={selection === p.id}
            hovered={hovered === p.id}
            interactive={interactive}
          />
        );
      })}
    </group>
  );
}
