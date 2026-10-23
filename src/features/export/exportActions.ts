import { geometry } from '../../geometry/client';
import type { ExportFormat } from '../../geometry/types';
import { packProject } from '../../io';
import { downloadBytes, safeFileName } from '../../lib/download';
import { getDoc } from '../../store/history';
import { sourceMeshes } from '../../store/persistence';
import { setUI, toast, useUI } from '../../store/ui';
import { partColor } from '../paint/colors';

const LABEL: Record<ExportFormat, { ext: string; name: string }> = {
  'stl-zip': { ext: 'zip', name: 'STL (.zip)' },
  'obj-zip': { ext: 'zip', name: 'OBJ (.zip)' },
  '3mf': { ext: '3mf', name: '3MF' },
};

/** Exports every visible part (one file per part, or one 3MF object per part). */
export async function exportParts(format: ExportFormat) {
  const doc = getDoc();
  const parts = useUI.getState().parts.filter((p) => doc.partMeta[p.id]?.visible !== false);
  if (!parts.length) {
    toast('warning', 'Nada para exportar', 'Importe um modelo ou mostre partes ocultas.');
    return;
  }
  setUI({ busy: true, busyLabel: `Exportando ${LABEL[format].name}…` });
  try {
    const data = await geometry().exportParts(
      format,
      parts.map((p) => ({
        id: p.id,
        name: doc.partMeta[p.id]?.name ?? p.name,
        color: partColor(doc, p),
        slot: doc.partMeta[p.id]?.slot ?? 1,
        down: doc.partMeta[p.id]?.down,
      })),
    );
    const suffix = format === 'obj-zip' ? '-obj' : '';
    downloadBytes(data, `${safeFileName(doc.name)}${suffix}.${LABEL[format].ext}`);
    toast('success', `${parts.length} parte(s) exportada(s) em ${LABEL[format].name}`);
  } catch (e) {
    toast('error', 'Falha ao exportar', e instanceof Error ? e.message : String(e));
  } finally {
    setUI({ busy: false });
  }
}

/** Saves the editable project (`.fenda`: JSON history + source meshes). */
export function saveProjectFile() {
  const doc = getDoc();
  const meshes = Object.fromEntries(doc.sources.filter((s) => sourceMeshes.has(s.id)).map((s) => [s.id, sourceMeshes.get(s.id)!]));
  downloadBytes(packProject(doc, meshes), `${safeFileName(doc.name)}.fenda`);
  toast('success', 'Projeto salvo como .fenda');
}
