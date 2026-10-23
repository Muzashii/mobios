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

export type ConnectorType = 'pin' | 'dowel';

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
}

export type Operation =
  | { kind: 'cut-plane'; id: string; target: PartId; plane: Plane; bounded?: SphereBounds }
  | { kind: 'connector'; id: string; joint: string; type: ConnectorType; params: ConnectorParams };

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
}

export interface JointInfo {
  id: string;
  a: PartId;
  b: PartId;
  plane: Plane;
  bounded?: SphereBounds;
  faceArea: number;
  label: string;
}

export interface OpReport {
  error?: string;
  warnings: string[];
  info?: string;
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
}

export type ExportFormat = 'stl-zip' | '3mf' | 'obj-zip';
