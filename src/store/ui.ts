import type { BufferGeometry } from 'three';
import { create } from 'zustand';
import type { ConnectorParams, ConnectorType, CutProfile, JointInfo, OpReport, PartId, PartStats, Plane, StrokeFrame, Vec2, Vec3 } from '../geometry/types';

export type Tool = 'select' | 'cut' | 'paint' | 'brush' | 'draw';

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

export interface CutDraft {
  target: PartId;
  /** 'plane' (optionally profiled/bounded) or a free-hand 'surface'. */
  mode: 'plane' | 'surface';
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
  radius: number;
}

interface UIState {
  tool: Tool;
  brush: BrushState;
  selection: PartId | null;
  hovered: PartId | null;
  draft: CutDraft | null;
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
  focusRequest: { id: PartId | 'all'; n: number };
  ready: boolean;
}

export const useUI = create<UIState>(() => ({
  tool: 'select',
  brush: { target: null, seeds: [], radius: 4 },
  selection: null,
  hovered: null,
  draft: null,
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
      return localStorage.getItem('fenda-theme') === 'light' ? 'light' : 'dark';
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
