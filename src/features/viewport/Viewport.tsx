import { CameraControls, GizmoHelper, GizmoViewport, Grid, Line } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, BufferGeometry, Mesh, Object3D, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { useHistory } from '../../store/history';
import { printerOf } from '../../store/project';
import { setUI, useUI } from '../../store/ui';
import { tokens } from '../../ui/tokens';
import { assemblyOffsets } from '../assembly/assembly';
import { explodeOffsets } from '../assembly/explode';
import { BrushLayer } from '../smartcut/BrushLayer';
import { CutPreview } from './CutPreview';
import { SurfacePreview } from './SurfacePreview';
import { viewportRefs } from './viewportRefs';
import { Parts } from './Parts';

// 3D printing convention: Z is up.
Object3D.DEFAULT_UP.set(0, 0, 1);

// BVH-accelerated raycasting (hover, selection, brush) on large meshes.
// Cast: @types/three still declares the older MeshBVH signature for this augmentation.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree as unknown as BufferGeometry['computeBoundsTree'];
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/** Builds BVHs off the critical path, after new parts arrive. */
function useBoundsTrees() {
  const parts = useUI((s) => s.parts);
  useEffect(() => {
    const pending = parts.filter((p) => !p.geometry.boundsTree);
    if (!pending.length) return;
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb) : setTimeout(cb, 50));
    let i = 0;
    const step = () => {
      const p = pending[i++];
      if (!p) return;
      if (!p.geometry.boundsTree) p.geometry.computeBoundsTree();
      idle(step);
    };
    idle(step);
  }, [parts]);
}

function CameraBridge() {
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    viewportRefs.camera = camera;
    viewportRefs.canvas = canvas;
  }, [camera, canvas]);
  return null;
}

function useSceneBox() {
  const parts = useUI((s) => s.parts);
  return useMemo(() => {
    const box = new Box3();
    for (const p of parts) {
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    return box;
  }, [parts]);
}

function CameraRig() {
  const controls = useRef<CameraControls>(null);
  const focusRequest = useUI((s) => s.focusRequest);
  const sceneBox = useSceneBox();

  useEffect(() => {
    const c = controls.current;
    if (!c || focusRequest.n === 0) return;
    const { parts, explode, assembly } = useUI.getState();
    let box: Box3;
    if (focusRequest.id === 'all') {
      box = sceneBox.clone();
      if (explode > 0) box.expandByScalar(box.getSize(new Vector3()).length() * 0.35 * explode);
      // Assembly simulation pulls parts apart by ~30% of the scene size per joint level.
      if (assembly !== null) box.expandByScalar(box.getSize(new Vector3()).length() * 0.3);
    } else {
      const p = parts.find((x) => x.id === focusRequest.id);
      if (!p) return;
      const off = explodeOffsets(parts, explode).get(p.id) ?? new Vector3();
      box = p.geometry.boundingBox!.clone().translate(off);
    }
    if (box.isEmpty()) return;
    void c.fitToBox(box, true, { paddingTop: 0.15, paddingBottom: 0.15, paddingLeft: 0.15, paddingRight: 0.15 });
  }, [focusRequest, sceneBox]);

  useEffect(() => {
    void controls.current?.setLookAt(-220, -260, 200, 0, 0, 40, false);
  }, []);

  // Brush and free-hand tools own the left button; orbit moves to the right button.
  const tool = useUI((s) => s.tool);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { ACTION } = CameraControlsImpl;
    const painting = tool === 'brush';
    c.mouseButtons.left = painting ? ACTION.NONE : ACTION.ROTATE;
    c.mouseButtons.right = painting ? ACTION.ROTATE : ACTION.TRUCK;
  }, [tool]);

  return <CameraControls ref={controls} makeDefault smoothTime={0.28} draggingSmoothTime={0.08} dollyToCursor />;
}

/** Printer build volume, centred under the model, standing on its lowest point. */
function BedVolume() {
  const doc = useHistory((s) => s.doc);
  const show = useUI((s) => s.showBed);
  const box = useSceneBox();
  const theme = useUI((s) => s.theme);
  if (!show || box.isEmpty()) return null;
  const [x, y, z] = printerOf(doc).volume;
  const c = box.getCenter(new Vector3());
  const z0 = box.min.z;
  const pts = (zz: number): [number, number, number][] => [
    [c.x - x / 2, c.y - y / 2, zz], [c.x + x / 2, c.y - y / 2, zz], [c.x + x / 2, c.y + y / 2, zz], [c.x - x / 2, c.y + y / 2, zz], [c.x - x / 2, c.y - y / 2, zz],
  ];
  const color = tokens[theme].gridStrong;
  return (
    <group>
      <Line points={pts(z0)} color={color} lineWidth={1.2} />
      <Line points={pts(z0 + z)} color={color} lineWidth={1} dashed dashSize={4} gapSize={4} transparent opacity={0.6} />
      {[0, 1, 2, 3].map((i) => (
        <Line key={i} points={[pts(z0)[i], pts(z0 + z)[i]]} color={color} lineWidth={1} dashed dashSize={4} gapSize={4} transparent opacity={0.6} />
      ))}
    </group>
  );
}

function Scene() {
  const parts = useUI((s) => s.parts);
  const explode = useUI((s) => s.explode);
  const draft = useUI((s) => s.draft);
  const theme = useUI((s) => s.theme);
  const box = useSceneBox();
  const assembly = useUI((s) => s.assembly);
  const joints = useUI((s) => s.joints);
  const offsets = useMemo(
    () => (assembly !== null ? assemblyOffsets(parts, joints, assembly) : explodeOffsets(parts, explode)),
    [parts, joints, explode, assembly],
  );
  useBoundsTrees();
  const t = tokens[theme];
  const gridZ = box.isEmpty() ? 0 : box.min.z - 0.05;
  const span = box.isEmpty() ? 200 : Math.max(200, box.getSize(new Vector3()).length() * 3);

  return (
    <>
      <hemisphereLight args={['#ffffff', theme === 'dark' ? '#202024' : '#b9b5ad', 1.1]} />
      <directionalLight position={[180, -240, 320]} intensity={1.6} />
      <directionalLight position={[-260, 200, 120]} intensity={0.55} color="#c9d6ff" />
      <directionalLight position={[0, 300, -150]} intensity={0.35} />

      <Grid
        position={[box.isEmpty() ? 0 : box.getCenter(new Vector3()).x, box.isEmpty() ? 0 : box.getCenter(new Vector3()).y, gridZ]}
        rotation={[Math.PI / 2, 0, 0]}
        args={[span, span]}
        cellSize={10}
        sectionSize={50}
        cellColor={t.grid}
        sectionColor={t.gridStrong}
        cellThickness={0.6}
        sectionThickness={1}
        fadeDistance={span * 1.2}
        fadeStrength={1.5}
        infiniteGrid
      />
      <BedVolume />

      <Parts offsets={offsets} hiddenId={draft?.target} />
      {draft && (draft.mode === 'surface' ? <SurfacePreview draft={draft} /> : <CutPreview draft={draft} />)}
      <BrushLayer />
      <CameraBridge />

      <CameraRig />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ff5a5f', '#3dd68c', '#3a86ff']} labelColor={theme === 'dark' ? '#0e0f12' : '#ffffff'} />
      </GizmoHelper>
    </>
  );
}

export function Viewport() {
  const theme = useUI((s) => s.theme);
  const t = tokens[theme];
  return (
    <div
      className="absolute inset-0"
      style={{ background: `radial-gradient(ellipse at 50% 35%, ${t.viewportTop} 0%, ${t.viewportBottom} 100%)` }}
      data-testid="viewport"
    >
      <Canvas
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
        dpr={[1, 2]}
        camera={{ fov: 38, near: 0.5, far: 50000, up: [0, 0, 1], position: [-220, -260, 200] }}
        onPointerMissed={(e) => {
          if (e.button === 0 && !useUI.getState().draft) setUI({ selection: null });
        }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
