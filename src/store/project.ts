import { TOLERANCE_PRESETS } from '../geometry/connectors';
import type { Operation, PartId, SourceRef, Technology, Vec3 } from '../geometry/types';

export interface PrinterProfile {
  id: string;
  name: string;
  technology: Technology;
  /** Build volume X × Y × Z (mm). */
  volume: Vec3;
}

export const PRINTERS: PrinterProfile[] = [
  { id: 'bambu-a1', name: 'Bambu Lab A1', technology: 'FDM', volume: [256, 256, 256] },
  { id: 'bambu-a1-mini', name: 'Bambu Lab A1 mini', technology: 'FDM', volume: [180, 180, 180] },
  { id: 'bambu-x1', name: 'Bambu Lab X1 / P1', technology: 'FDM', volume: [256, 256, 256] },
  { id: 'elegoo-mars5-ultra', name: 'ELEGOO Mars 5 Ultra', technology: 'RESINA', volume: [153.36, 77.76, 165] },
  { id: 'generic-resin', name: 'Resina genérica 8K', technology: 'RESINA', volume: [218, 123, 220] },
];

export interface PartMeta {
  name?: string;
  /** 1-based filament slot (AMS). Undefined = automatic colour, slot 1 on export. */
  slot?: number;
  visible?: boolean;
  locked?: boolean;
  /** Side to put on the build plate when exporting (suggested orientation). */
  down?: Vec3;
}

export interface ProjectDoc {
  schema: 1;
  id: string;
  name: string;
  technology: Technology;
  printerId: string;
  /** Default connector clearance per technology (mm). */
  clearance: Record<Technology, number>;
  /** Colours of the 4 filament slots (AMS / AMS lite / BMCU). */
  filaments: string[];
  sources: SourceRef[];
  operations: Operation[];
  partMeta: Record<PartId, PartMeta>;
}

export const DEFAULT_FILAMENTS = ['#E8E4DC', '#FF6B2C', '#3A86FF', '#2B2D31'];

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createProject(name = 'Sem título'): ProjectDoc {
  return {
    schema: 1,
    id: newId('p'),
    name,
    technology: 'FDM',
    printerId: 'bambu-a1',
    clearance: { FDM: TOLERANCE_PRESETS.FDM.clearance, RESINA: TOLERANCE_PRESETS.RESINA.clearance },
    filaments: [...DEFAULT_FILAMENTS],
    sources: [],
    operations: [],
    partMeta: {},
  };
}

export const printerOf = (doc: ProjectDoc) => PRINTERS.find((p) => p.id === doc.printerId) ?? PRINTERS[0];
