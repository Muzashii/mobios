import type { BufferGeometry } from 'three';
import { create } from 'zustand';
import type { PartMapResult, Bounds, ConnectorParams, ConnectorType, CutCheck, CutProfile, InspectionReport, JointInfo, OpReport, PartId, PartStats, Plane, RegionBall, RegionCutMode, RepairPlan, SmartCutCandidate, StrokeFrame, Vec2, Vec3 } from '../geometry/types';

export type Tool = 'select' | 'cut' | 'paint' | 'brush' | 'draw';
/** Step of the flow shown in the side panel: model → split → fit → colours. */
export type Step = 'model' | 'split' | 'fit' | 'color';

export interface ConnectorDraft {
  enabled: boolean;
  type: ConnectorType;
  params: ConnectorParams;
}

export interface SurfaceDraft {
  frame: StrokeFrame;
  points: Vec2[];
  flip: boolean;
}

/** SmartCut v2 region cut being reviewed (one per cluster of seeds). */
export interface RegionDraft {
  balls: RegionBall[];
  seeds: Vec3[];
  negSeeds: Vec3[];
  /** Candidates from the suggestion (Tab cycles); empty when editing an existing cut. */
  candidates: SmartCutCandidate[];
  index: number;
  level: number;
  mode: RegionCutMode;
  /** Shell thickness (mm). */
  depth: number;
  name: string;
  /** Cut by detected parts (SmartCut hover): points on the parts that leave. */
  partSeeds?: Vec3[];
  /** Parts come from this earlier piece's map (a "Separar em N peças" chain). */
  mapFrom?: PartId;
}

export interface CutDraft {
  target: PartId;
  /** 'plane' (optionally profiled/bounded), a free-hand 'surface' or a SmartCut 'region'. */
  mode: 'plane' | 'surface' | 'region';
  region?: RegionDraft;
  /** Other SmartCut clusters to cut in the same commit (dabs on head and hand → 2 cuts). */
  batch?: RegionDraft[];
  /** Name for what is left after the whole batch ("Separar em N peças": the body's part). */
  restName?: string;
  plane: Plane;
  profile: CutProfile | null;
  surface?: SurfaceDraft;
  /** Ring found by SmartCut, shown while the suggestion is reviewed. */
  smartRing?: Vec3[];
  bounded: boolean;
  radius: number;
  connector: ConnectorDraft;
  /** Engrave the joint number on both faces. */
  label: boolean;
  /** Existing label operation on this joint, if any. */
  labelOpId?: string;
  /** Set when editing an existing cut. */
  editingOpId?: string;
  /** Existing connector operation on this joint, if any. */
  connectorOpId?: string;
  /** Geometry of the target before the edited cut (only when editing). */
  previewGeometry?: BufferGeometry;
}

export interface ViewPart {
  id: PartId;
  name: string;
  version: number;
  geometry: BufferGeometry;
  stats: PartStats;
  producedBy?: string;
  lineage: string[];
  autoColor: string;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

/** SmartCut brush: painted seed points on one part. */
export interface BrushState {
  target: PartId | null;
  seeds: Vec3[];
  /** Shift + brush: what must stay with the body. */
  negSeeds: Vec3[];
  radius: number;
}

/** Live dry-run of the draft (pre-validation). */
export interface CutCheckState {
  key: string;
  pending: boolean;
  result: CutCheck | null;
  /** Part B rendered from the dry-run (region cuts). */
  previewB?: BufferGeometry;
}

/** SmartCut hover: the part that would be separated if the user clicked here. */
export interface HoverPreview {
  part: PartId;
  geometry: BufferGeometry;
  loops: Vec3[][];
  name?: string;
  confidence: number;
}

/** Automatic part map of a part version (labels per display triangle), computed in the worker. */
export interface PartMapCache {
  version: number;
  status: 'pending' | 'ready' | 'error';
  result?: PartMapResult;
  error?: string;
}

/** Raio-X panel: inspection reports waiting for the user's repair choices. */
export interface XRayState {
  reports: InspectionReport[];
  index: number;
  plans: RepairPlan[];
  /** Issue highlighted in the viewport. */
  focusIssue: number | null;
  fileName: string;
  /** Set when repairing a mesh already in the project (the result replaces that source). */
  repairOf?: PartId;
}

interface UIState {
  step: Step;
  tool: Tool;
  brush: BrushState;
  /** SmartCut: free brush instead of picking detected parts. */
  brushAdvanced: boolean;
  selection: PartId | null;
  hovered: PartId | null;
  draft: CutDraft | null;
  cutCheck: CutCheckState | null;
  hover: HoverPreview | null;
  xray: XRayState | null;
  partMaps: Record<PartId, PartMapCache>;
  /** Detected part under the cursor (or the list row under it). */
  mapHover: { part: PartId; group: number } | null;
  /** Connector operation open in the inspector. */
  connectorEdit: string | null;
  explode: number;
  /** Assembly simulation progress (0 = apart, 1 = assembled); null = off. */
  assembly: number | null;
  assemblyPlaying: boolean;
  parts: ViewPart[];
  joints: JointInfo[];
  reports: Record<string, OpReport>;
  busy: boolean;
  /** Message shown in the busy pill. */
  busyLabel: string;
  lastEvalMs: number;
  toasts: Toast[];
  theme: 'dark' | 'light';
  showBed: boolean;
  paletteOpen: boolean;
  /** Filament slot applied by the paint tool. */
  activeSlot: number;
  /** Set after the first successful export (onboarding step 4). */
  exportedOnce: boolean;
  /** Bumped to ask the viewport to frame something. */
  focusRequest: { id: PartId | 'all' | 'box'; n: number; box?: Bounds };
  ready: boolean;
}

/** Piece the split step works on: the selection, or the only visible piece. */
export function splitTarget(s: Pick<UIState, 'selection' | 'parts'>): PartId | null {
  return s.selection ?? (s.parts.filter((p) => !p.id.endsWith('.pins')).length === 1 ? s.parts.find((p) => !p.id.endsWith('.pins'))!.id : null);
}

export const useUI = create<UIState>(() => ({
  step: 'model',
  tool: 'select',
  brush: { target: null, seeds: [], negSeeds: [], radius: 4 },
  brushAdvanced: false,
  selection: null,
  hovered: null,
  draft: null,
  cutCheck: null,
  hover: null,
  xray: null,
  partMaps: {},
  mapHover: null,
  connectorEdit: null,
  explode: 0,
  assembly: null,
  assemblyPlaying: false,
  parts: [],
  joints: [],
  reports: {},
  busy: false,
  busyLabel: '',
  lastEvalMs: 0,
  toasts: [],
  theme: (() => {
    try {
      return (localStorage.getItem('mobios-theme') ?? localStorage.getItem('fenda-theme')) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  })(),
  showBed: true,
  paletteOpen: false,
  activeSlot: 2,
  exportedOnce: false,
  focusRequest: { id: 'all', n: 0 },
  ready: false,
}));

export const setUI = useUI.setState;

let toastSeq = 1;
export function toast(kind: ToastKind, title: string, detail?: string, ms = 4500) {
  const id = toastSeq++;
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, title, detail }] }));
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function focus(id: PartId | 'all') {
  useUI.setState((s) => ({ focusRequest: { id, n: s.focusRequest.n + 1 } }));
}

/** Frames an arbitrary box (Raio-X "Mostrar"). */
export function focusBox(box: Bounds) {
  useUI.setState((s) => ({ focusRequest: { id: 'box', n: s.focusRequest.n + 1, box } }));
}
