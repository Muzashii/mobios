// Shared contracts between the UI thread and the geometry worker.
// Everything here must survive structured clone.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type PartId = string;

/** Indexed triangle mesh (millimetres). */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Non-indexed mesh ready for rendering, with creased normals. */
export interface DisplayMesh {
  positions: Float32Array;
  normals: Float32Array;
}

export interface Plane {
  origin: Vec3;
  /** Unit normal. Part "B" is the side the normal points to. */
  normal: Vec3;
}

/** Bounded cut: only islands whose cut face lies inside this sphere are separated. */
export interface SphereBounds {
  center: Vec3;
  radius: number;
}

export type Technology = 'FDM' | 'RESINA';

/**
 * pin/square/hex/key: male peg on one side, socket on the other (square/hex/key lock rotation,
 * key also forces a single orientation). dowel: sockets on both sides + loose pins.
 * magnet: sockets for magnets on both sides. dovetail: sliding rail across the face.
 */
export type ConnectorType = 'pin' | 'square' | 'hex' | 'key' | 'dowel' | 'magnet' | 'dovetail';

export interface ConnectorParams {
  /** Pin diameter (mm). */
  diameter: number;
  /** Depth into each part (mm). */
  depth: number;
  /** Radial clearance (mm). */
  clearance: number;
  /** Chamfer at the pin tip / hole entrance (mm). */
  chamfer: number;
  /** Minimum wall left around a hole (mm). */
  minWall: number;
  /** Pins per face island, or automatic. */
  count: number | 'auto';
  /** Which side receives the male pin (only for `pin`). */
  maleSide: 'a' | 'b';
}

export interface SourceRef {
  id: PartId;
  name: string;
  /** What the Raio-X repair changed on import (shown in the history). */
  repair?: string;
}

/** Non-flat joint profile across the cut plane: hides the seam and locks rotation. */
export interface CutProfile {
  kind: 'step' | 'zigzag' | 'wave';
  /** Peak-to-peak height along the normal (mm). */
  amplitude: number;
  /** Wavelength (zigzag/wave) or unused (step) (mm). */
  period: number;
}

/** Orthonormal frame a free-hand stroke was drawn in (u = right, v = up, n = towards viewer). */
export interface StrokeFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  /** Camera position for perspective views: the cut follows the camera rays. */
  eye?: Vec3;
}

/** Ball of the SmartCut seed region (the SDF turns a brush dab into the ball inscribed in the limb). */
export interface RegionBall {
  c: Vec3;
  r: number;
  /** Brush dab the ball grows from (the region is flood-filled from here inside the ball). */
  s?: Vec3;
}

/**
 * How a SmartCut region leaves the part.
 * surface: curved joint that follows the ring exactly (flat centre for pins and numbering).
 * plane: classic plane cut, island picked by the seeds. shell: hair/helmet as a shell with
 * `depth` thickness, leaving a matching recess. auto: surface, falling back to plane.
 */
export type RegionCutMode = 'auto' | 'surface' | 'plane' | 'shell';

/** What the selected region looks like (decides the default mode and the part's name). */
export type RegionKind = 'limb' | 'crease' | 'shell';

export type Operation =
  | { kind: 'cut-plane'; id: string; target: PartId; plane: Plane; bounded?: SphereBounds; profile?: CutProfile }
  | { kind: 'cut-surface'; id: string; target: PartId; frame: StrokeFrame; points: Vec2[]; flip?: boolean }
  | { kind: 'connector'; id: string; joint: string; type: ConnectorType; params: ConnectorParams }
  | { kind: 'label'; id: string; joint: string; size: number; depth: number }
  | { kind: 'hollow'; id: string; target: PartId; wall: number; drainDiameter: number; drainCount: number }
  | RegionCutOperation;

/**
 * SmartCut v2 cut. Stores the inputs, not the curve: re-running the history recomputes the
 * region (geodesic distance from `balls`, ring at `level`, min-cut snapping) on whatever mesh
 * the target has at that point, so editing an earlier cut never leaves a stale loop.
 */
export interface RegionCutOperation {
  kind: 'cut-region';
  id: string;
  target: PartId;
  balls: RegionBall[];
  /** Brush/click points that must end up in B. */
  seeds: Vec3[];
  /** Points that must stay in A (Shift + brush). */
  negSeeds?: Vec3[];
  /** Geodesic distance (mm) of the ring from the seed region. */
  level: number;
  mode: RegionCutMode;
  /** Shell thickness (mm), `shell` mode only. */
  depth?: number;
  /** Fitted plane of the ring (normal towards B): fallback plane cut, pins and labels. */
  plane: Plane;
  /** Name given to part B (e.g. "Cabeça"). */
  name?: string;
}

export type CutOperation = Extract<Operation, { kind: 'cut-plane' | 'cut-surface' | 'cut-region' }>;

/** One candidate separation found by SmartCut (Tab cycles through them). */
export interface SmartCutCandidate {
  level: number;
  /** Fitted plane of the ring, normal towards the seeds (B). */
  plane: Plane;
  /** Radius of the ring around its centroid (mm). */
  radius: number;
  /** Boundary loops of B, ordered (world). Usually one; more when the part forms a handle. */
  loops: Vec3[][];
  perimeter: number;
  /** Max distance of the ring to its plane relative to the radius (0 = flat). */
  planarity: number;
  confidence: number;
  kind: RegionKind;
  /** Share of the part's area that goes to B. */
  areaShare: number;
  /** B side as a triangle soup (analysis mesh) for the hover/preview highlight. */
  preview: Float32Array;
  /** Guessed name for part B ("Cabeça", "Braço"…), editable later. */
  name?: string;
}

/** SmartCut suggestion: candidates (best first) for one cluster of seeds. */
/** One automatic part of a figure (part map, see segment/parts.ts). */
export interface AutoPart {
  id: number;
  /** Suggested name ("Chapéu", "Braço esquerdo"…); the user may rename it. */
  name: string;
  /** Share of the surface (0–1). */
  share: number;
  centroid: Vec3;
}

/** Part map of one part: a label per triangle of its display mesh (same order) and the parts. */
export interface PartMapResult {
  labels: Uint16Array;
  parts: AutoPart[];
  ms: number;
}

export interface SmartCutSuggestion {
  plane: Plane;
  radius: number;
  /** Ring points (world) for display (best candidate). */
  ring: Vec3[];
  /** Perimeter of the chosen ring (mm). */
  perimeter: number;
  confidence: number;
  /** Seed region used (stored in the operation). */
  balls: RegionBall[];
  seeds: Vec3[];
  candidates: SmartCutCandidate[];
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface PartStats {
  volume: number;
  area: number;
  triangles: number;
  genus: number;
  components: number;
  bounds: Bounds;
}

export interface PartResult {
  id: PartId;
  name: string;
  /** Changes whenever the geometry changes. */
  version: number;
  /** Present only when the UI does not have this version yet. */
  mesh?: DisplayMesh;
  stats: PartStats;
  /** Operation that produced the part (undefined for sources). */
  producedBy?: string;
  /** Joint sides this part descends from, e.g. ["c1.b", "c3.a"] (assembly simulation). */
  lineage: string[];
}

export interface JointInfo {
  id: string;
  a: PartId;
  b: PartId;
  plane: Plane;
  bounded?: SphereBounds;
  faceArea: number;
  label: string;
  /** Connectors need a flat, unprofiled face. */
  planar: boolean;
  /** Curved SmartCut joint: only the disc of this radius around the plane origin is flat. */
  faceRadius?: number;
  /** Direction part B travels to come off part A (assembly simulation). */
  insertDir: Vec3;
  /** Connector footprints on the face (plane-frame 2D), kept clear by labels. */
  obstacles: { c: Vec2; r: number }[];
  /** Result of the insertion sweep check, when a connector exists. */
  assemblyClear?: boolean;
}

/** Action the UI offers next to a cut error (pt-BR labels live in the UI). */
export type CutHint = 'grow-radius' | 'move-plane' | 'unbound' | 'pick-islands' | 'use-region' | 'smaller-depth';

export interface OpReport {
  error?: string;
  /** Suggested fix for `error`. */
  hint?: CutHint;
  warnings: string[];
  info?: string;
}

/** Result of a cut dry-run (pre-validation while the user edits the draft). */
export interface CutCheck {
  ok: boolean;
  error?: string;
  hint?: CutHint;
  /** Islands B / A will have. */
  piecesB: number;
  piecesA: number;
  volumeB: number;
  volumeA: number;
  warnings: string[];
  /** Part B for region cuts (render mesh), so the preview shows the real piece. */
  previewB?: DisplayMesh;
}

export interface EvalResult {
  parts: PartResult[];
  joints: JointInfo[];
  reports: Record<string, OpReport>;
  ms: number;
}

export interface ImportedMesh {
  id: PartId;
  name: string;
  mesh: MeshData;
  report: string[];
}

export interface ExportPart {
  id: PartId;
  name: string;
  color: string;
  slot: number;
  /** Side to put on the plate (suggested orientation); rotated to −Z on export. */
  down?: Vec3;
}

export type ExportFormat = 'stl-zip' | '3mf' | 'obj-zip';

// ---------------------------------------------------------------------------
// Raio-X da malha (mesh inspection on import) — see docs/ADR/0009.

export type IssueKind =
  | 'holes'
  | 'non-manifold'
  | 'orientation'
  | 'self-intersections'
  | 'shells'
  | 'inner-shells'
  | 'degenerate'
  | 'thin-walls'
  | 'scale'
  | 'huge'
  | 'needles'
  | 'genus'
  | 'fit';

export type IssueSeverity = 'info' | 'warning' | 'critical';

/** Heatmap overlay of an issue: edge segments, triangles or points (world, mm). */
export interface IssueMarkers {
  type: 'edges' | 'faces' | 'points';
  positions: Float32Array;
}

export interface RepairChoice {
  value: string;
  label: string;
  hint?: string;
}

export interface MeshIssue {
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  detail: string;
  count: number;
  /** Repair options (first = recommended); empty when the issue is information only. */
  options: RepairChoice[];
  /** Region to frame with "Mostrar". */
  focus?: Bounds;
  markers?: IssueMarkers;
}

export interface InspectionReport {
  /** Pending import id (worker keeps the raw mesh until the user decides). */
  id: string;
  name: string;
  grade: 'ok' | 'repair' | 'critical';
  triangles: number;
  vertices: number;
  size: Vec3;
  bounds: Bounds;
  shells: number;
  /** Signed volume when the mesh is closed (mm³). */
  volume: number | null;
  issues: MeshIssue[];
  ms: number;
  /** Render mesh of the raw file (shown under the heatmap). */
  preview: DisplayMesh;
}

/** User's choice per issue kind (values from `MeshIssue.options`). */
export type RepairPlan = Partial<Record<IssueKind, string>> & {
  /** Debris threshold (mm³) when `shells` removes small floating pieces. */
  debrisVolume?: number;
  /** Voxels along the longest side for the volumetric remesh. */
  volumetricResolution?: number;
};

export interface RepairOutcome {
  /** One entry per resulting source (several when shells are kept as separate parts). */
  meshes: ImportedMesh[];
  /** Human summary ("12 furos fechados · …"). */
  summary: string;
}
