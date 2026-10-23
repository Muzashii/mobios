import type { BufferGeometry } from 'three';
import { create } from 'zustand';
import type { ConnectorParams, ConnectorType, JointInfo, OpReport, PartId, PartStats, Plane } from '../geometry/types';

export type Tool = 'select' | 'cut' | 'paint';

export interface ConnectorDraft {
  enabled: boolean;
  type: ConnectorType;
  params: ConnectorParams;
}

export interface CutDraft {
  target: PartId;
  plane: Plane;
  bounded: boolean;
  radius: number;
  connector: ConnectorDraft;
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
  autoColor: string;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface UIState {
  tool: Tool;
  selection: PartId | null;
  hovered: PartId | null;
  draft: CutDraft | null;
  /** Connector operation open in the inspector. */
  connectorEdit: string | null;
  explode: number;
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
  /** Bumped to ask the viewport to frame something. */
  focusRequest: { id: PartId | 'all'; n: number };
  ready: boolean;
}

export const useUI = create<UIState>(() => ({
  tool: 'select',
  selection: null,
  hovered: null,
  draft: null,
  connectorEdit: null,
  explode: 0,
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
