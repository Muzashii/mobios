import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, type Vector3 } from 'three';
import type { PartMapResult, Vec3 } from '../../geometry/types';
import type { PartMapEdits } from '../../store/project';
import { focus, setUI, useUI, type ViewPart } from '../../store/ui';
import { ACCENT, mapPartColor } from '../../ui/tokens';
import { groupOf } from '../parts/groups';

/**
 * A part painted by its automatic part map: one colour per detected part (after the user's
 * merges); the part under the cursor (or under the list row) glows. Shares the part's vertex
 * buffers and adds a colour and a group id per vertex.
 */
export function PartMapMesh({
  part,
  offset,
  result,
  edits,
  interactive,
  mono,
  onPick,
}: {
  part: ViewPart;
  offset: Vector3;
  result: PartMapResult;
  edits: PartMapEdits;
  interactive: boolean;
  /** One colour for the whole part (SmartCut: only the part under the cursor stands out). */
  mono?: string;
  /** Click picks the detected part under the cursor instead of selecting the mesh. */
  onPick?: (point: Vec3, group: number) => void;
}) {
  const groups = useMemo(() => groupOf(result, edits), [result, edits]);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', part.geometry.getAttribute('position'));
    g.setAttribute('normal', part.geometry.getAttribute('normal'));
    g.boundingBox = part.geometry.boundingBox;
    g.boundingSphere = part.geometry.boundingSphere;
    const { labels } = result;
    const color = new Uint8Array(labels.length * 9);
    const group = new Uint16Array(labels.length * 3);
    const rgb = new Map<number, number[]>();
    const c = new Color();
    for (let f = 0; f < labels.length; f++) {
      const root = groups[labels[f]] ?? 0;
      let v = rgb.get(root);
      if (!v) {
        c.set(mono ?? mapPartColor(root)).convertLinearToSRGB();
        rgb.set(root, (v = [c.r * 255, c.g * 255, c.b * 255]));
      }
      for (let k = 0; k < 3; k++) {
        color.set(v, f * 9 + k * 3);
        group[f * 3 + k] = root;
      }
    }
    g.setAttribute('color', new BufferAttribute(color, 3, true));
    g.setAttribute('aGroup', new BufferAttribute(group, 1));
    return g;
  }, [part.geometry, result, groups, mono]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const { material, uniforms } = useMemo(() => {
    const uniforms = { uHover: { value: -1 }, uHoverColor: { value: new Color(ACCENT) } };
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.04 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGroup;\nvarying float vGroup;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroup = aGroup;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGroup;\nuniform float uHover;\nuniform vec3 uHoverColor;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (abs(vGroup - uHover) < 0.5) totalEmissiveRadiance += uHoverColor * 0.45;');
    };
    return { material: m, uniforms };
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const h = useUI.getState().mapHover;
    uniforms.uHover.value = h && h.part === part.id ? h.group : -1;
  });

  const pick = (faceIndex: number | null | undefined) => (faceIndex == null ? null : (groups[result.labels[faceIndex]] ?? null));
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={offset}
      castShadow
      receiveShadow
      onPointerMove={
        interactive
          ? (e) => {
              e.stopPropagation();
              const group = pick(e.faceIndex);
              const cur = useUI.getState().mapHover;
              if (group === null) return;
              if (cur?.part !== part.id || cur.group !== group) setUI({ mapHover: { part: part.id, group }, hovered: part.id });
            }
          : undefined
      }
      onPointerOut={interactive ? () => useUI.getState().mapHover?.part === part.id && setUI({ mapHover: null, hovered: null }) : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              if (e.delta > 4) return; // the end of an orbit drag, not a click
              const group = pick(e.faceIndex);
              if (onPick && group !== null) onPick(e.point.clone().sub(e.object.position).toArray() as Vec3, group);
              else setUI({ selection: part.id, connectorEdit: null });
            }
          : undefined
      }
      onDoubleClick={interactive ? (e) => (e.stopPropagation(), focus(part.id)) : undefined}
    />
  );
}
