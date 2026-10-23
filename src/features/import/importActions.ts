import * as Comlink from 'comlink';
import { geometry } from '../../geometry/client';
import type { ImportedMesh } from '../../geometry/types';
import { unpackProject } from '../../io';
import { pickFiles } from '../../lib/download';
import { addSources } from '../../store/commands';
import { dispatch, getDoc, useHistory } from '../../store/history';
import { createProject, newId, type ProjectDoc } from '../../store/project';
import { pruneMeshes, saveDocNow, saveMesh } from '../../store/persistence';
import { requestEvaluate } from '../../store/sync';
import { focus, setUI, toast, useUI } from '../../store/ui';

export const ACCEPT = '.stl,.obj,.3mf,.fenda';

function scaleWarning(m: ImportedMesh) {
  const p = m.mesh.positions;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p[i + k]);
    max[k] = Math.max(max[k], p[i + k]);
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (size < 4) return `Maior dimensão de ${size.toFixed(2)} mm — o arquivo pode estar em polegadas ou metros.`;
  if (size > 3000) return `Maior dimensão de ${(size / 1000).toFixed(1)} m — verifique a unidade do arquivo.`;
  return null;
}

async function registerImported(list: ImportedMesh[], label: string) {
  for (const m of list) await saveMesh(m.id, m.mesh);
  const wasEmpty = getDoc().sources.length === 0;
  dispatch(addSources(list.map(({ id, name }) => ({ id, name }))));
  if (wasEmpty) setTimeout(() => focus('all'), 50);
  const repaired = list.filter((m) => m.report.length);
  for (const m of repaired) toast('warning', `${m.name}: malha reparada`, m.report.join(' · '), 7000);
  for (const m of list) {
    const w = scaleWarning(m);
    if (w) toast('warning', `${m.name}: escala suspeita`, w, 8000);
  }
  if (!repaired.length) toast('success', label);
}

export async function importFiles(files: File[]) {
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.fenda')) {
      await openFenda(file);
      continue;
    }
    setUI({ busy: true, busyLabel: `Importando ${file.name}…` });
    const t0 = performance.now();
    try {
      const buffer = await file.arrayBuffer();
      const list = await geometry().importFile(file.name, Comlink.transfer(buffer, [buffer]), newId('s'));
      const tris = list.reduce((s, m) => s + m.mesh.indices.length / 3, 0);
      await registerImported(list, `${file.name} importado — ${tris.toLocaleString('pt-BR')} triângulos em ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      toast('error', `Não foi possível importar ${file.name}`, e instanceof Error ? e.message : String(e), 8000);
    } finally {
      setUI({ busy: false });
    }
  }
}

export async function openFilePicker() {
  const files = await pickFiles(ACCEPT);
  if (files.length) await importFiles(files);
}

export async function openExample() {
  setUI({ busy: true, busyLabel: 'Gerando exemplo…' });
  try {
    const m = await geometry().example(newId('s'));
    await registerImported([m], 'Exemplo carregado — selecione a figura e pressione C para cortar');
  } finally {
    setUI({ busy: false });
  }
}

export async function addCalibration() {
  const tech = getDoc().technology;
  const list = await geometry().calibration(newId('cal'), tech);
  await registerImported(list, `Peça de calibração ${tech === 'FDM' ? 'FDM' : 'Resina'} adicionada — imprima e escolha a folga que encaixa`);
}

export async function openFenda(file: File) {
  try {
    const { doc, meshes } = unpackProject<ProjectDoc>(new Uint8Array(await file.arrayBuffer()));
    if (doc.schema !== 1) throw new Error('Versão de projeto desconhecida.');
    for (const [id, mesh] of Object.entries(meshes)) {
      await saveMesh(id, mesh);
      await geometry().registerSource(id, mesh);
    }
    resetView();
    useHistory.getState().load(doc);
    await saveDocNow(doc);
    requestEvaluate(true);
    setTimeout(() => focus('all'), 300);
    toast('success', `Projeto ${doc.name} aberto`);
  } catch (e) {
    toast('error', 'Não foi possível abrir o projeto', e instanceof Error ? e.message : String(e));
  }
}

function resetView() {
  for (const p of useUI.getState().parts) p.geometry.dispose();
  setUI({ parts: [], joints: [], reports: {}, selection: null, draft: null, connectorEdit: null, tool: 'select', explode: 0 });
}

export async function newProject() {
  resetView();
  const doc = createProject();
  useHistory.getState().load(doc);
  await saveDocNow(doc);
  await pruneMeshes(new Set());
}
