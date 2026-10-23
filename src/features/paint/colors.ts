import type { ProjectDoc } from '../../store/project';
import type { ViewPart } from '../../store/ui';

/** Display colour: the filament slot colour when assigned, else the automatic part colour. */
export function partColor(doc: ProjectDoc, part: Pick<ViewPart, 'id' | 'autoColor'>) {
  const slot = doc.partMeta[part.id]?.slot;
  return slot ? (doc.filaments[slot - 1] ?? part.autoColor) : part.autoColor;
}
