import type { Manifold } from 'manifold-3d';
import type { PartStats, Technology } from './types';

export function partStats(m: Manifold, components?: number): PartStats {
  const box = m.boundingBox();
  return {
    volume: m.volume(),
    area: m.surfaceArea(),
    triangles: m.numTri(),
    genus: m.genus(),
    components: components ?? countComponents(m),
    bounds: { min: [...box.min], max: [...box.max] },
  };
}

function countComponents(m: Manifold) {
  const parts = m.decompose();
  const n = parts.length;
  parts.forEach((p) => p.delete());
  return n;
}

/** Solid material density (g/cm³) used for estimates. */
export const DENSITY: Record<Technology, number> = { FDM: 1.24, RESINA: 1.12 };

/** Grams of material for a fully solid print (mm³ in). */
export function materialGrams(volumeMm3: number, tech: Technology) {
  return (volumeMm3 / 1000) * DENSITY[tech];
}
