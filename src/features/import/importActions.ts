import * as Comlink from 'comlink';
import { geometry } from '../../geometry/client';
import type { ImportedMesh, InspectionReport, RepairPlan } from '../../geometry/types';
import { unpackProject } from '../../io';
import { pickFiles } from '../../lib/download';
import { addSources } from '../../store/commands';
import { dispatch, getDoc, useHistory } from '../../store/history';
import { createProject, newId, printerOf, type ProjectDoc } from '../../store/project';
import { pruneMeshes, saveDocNow, saveMesh } from '../../store/persistence';
import { requestEvaluate } from '../../store/sync';
import { focus, focusBox, setUI, toast, useUI } from '../../store/ui';

// `.fenda` is the pre-rename project extension; still opened.
export const ACCEPT = '.stl,.obj,.3mf,.mobios,.fenda';
const isProjectFile = (name: string) => /\.(mobios|fenda)$/i.test(name);

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

async function registerImported(list: ImportedMesh[], label: string, repair?: string) {
  for (const m of list) await saveMesh(m.id, m.mesh);
  const wasEmpty = getDoc().sources.length === 0;
  dispatch(addSources(list.map(({ id, name }) => ({ id, name, ...(repair ? { repair } : {}) }))));
  if (repair !== undefined) {
    if (wasEmpty) setTimeout(() => focus('all'), 50);
    toast('success', label, repair, 7000);
    return;
  }
  if (wasEmpty) setTimeout(() => focus('all'), 50);
  const repaired = list.filter((m) => m.report.length);
  for (const m of repaired) toast('warning', `${m.name}: malha reparada`, m.report.join(' · '), 7000);
  for (const m of list) {
    const w = scaleWarning(m);
    if (w) toast('warning', `${m.name}: escala suspeita`, w, 8000);
  }
  if (!repaired.length) toast('success', label);
}

/** The recommended plan: first option of every issue. */
export function recommendedPlan(r: InspectionReport): RepairPlan {
  const plan: RepairPlan = {};
  for (const i of r.issues) if (i.options.length) plan[i.kind] = i.options[0].value;
  return plan;
}

/**
 * Import with Raio-X: the worker inspects the raw mesh and nothing is changed until the user
 * picks the repairs. A mesh without any problem goes straight in (nothing to decide).
 */
export async function importFiles(files: File[]) {
  for (const file of files) {
    if (isProjectFile(file.name)) {
      await openProjectFile(file);
      continue;
    }
    setUI({ busy: true, busyLabel: `Raio-X de ${file.name}…` });
    try {
      const buffer = await file.arrayBuffer();
      const doc = getDoc();
      const reports = await geometry().inspectFile(file.name, Comlink.transfer(buffer, [buffer]), newId('s'), doc.technology, printerOf(doc).volume);
      const clean = reports.every((r) => r.grade === 'ok' && r.issues.every((i) => i.severity === 'info' && i.options.length === 0));
      if (clean) {
        for (const r of reports) await finishOne(r, {});
        continue;
      }
      setUI({ busy: false });
      openXRay(file.name, reports);
      // One file at a time: the next waits until this panel is closed.
      await new Promise<void>((resolve) => {
        const off = useUI.subscribe((s) => {
          if (!s.xray) {
            off();
            resolve();
          }
        });
      });
    } catch (e) {
      toast('error', `Não foi possível importar ${file.name}`, e instanceof Error ? e.message : String(e), 8000);
    } finally {
      setUI({ busy: false });
    }
  }
}

function openXRay(fileName: string, reports: InspectionReport[]) {
  setUI({ xray: { reports, index: 0, plans: reports.map(recommendedPlan), focusIssue: null, fileName }, tool: 'select', draft: null });
  setTimeout(() => focusBox(reports[0].bounds), 60);
}

async function finishOne(r: InspectionReport, plan: RepairPlan) {
  const t0 = performance.now();
  const out = await geometry().finishImport(r.id, plan);
  const tris = out.meshes.reduce((s, m) => s + m.mesh.indices.length / 3, 0);
  await registerImported(out.meshes, `${r.name} importado — ${tris.toLocaleString('pt-BR')} triângulos (${((performance.now() - t0 + r.ms) / 1000).toFixed(1)} s)`, out.summary);
  if (plan.fit === 'autosplit' && out.meshes.length) {
    const { autoSplitPart } = await import('../analysis/PrintPrep');
    // Wait for the new source to be evaluated before splitting it.
    setTimeout(() => void autoSplitPart(out.meshes[0].id), 400);
  }
}

/** Raio-X "Reparar e importar" for the report on screen; moves to the next one. */
export async function applyXRay() {
  const x = useUI.getState().xray;
  if (!x) return;
  const r = x.reports[x.index];
  setUI({ busy: true, busyLabel: `Reparando ${r.name}…` });
  try {
    await finishOne(r, x.plans[x.index]);
    nextXRay();
  } catch (e) {
    toast('error', `Reparo de ${r.name} falhou`, `${e instanceof Error ? e.message : String(e)} — tente o remesh volumétrico.`, 9000);
  } finally {
    setUI({ busy: false });
  }
}

function nextXRay() {
  const x = useUI.getState().xray;
  if (!x) return;
  if (x.index + 1 < x.reports.length) {
    setUI({ xray: { ...x, index: x.index + 1, focusIssue: null } });
    focusBox(x.reports[x.index + 1].bounds);
  } else setUI({ xray: null });
}

/** Skips the mesh on screen (nothing is imported). */
export async function skipXRay() {
  const x = useUI.getState().xray;
  if (!x) return;
  await geometry().discardImport(x.reports[x.index].id);
  nextXRay();
}

export function setXRayChoice(patch: RepairPlan) {
  const x = useUI.getState().xray;
  if (!x) return;
  const plans = [...x.plans];
  plans[x.index] = { ...plans[x.index], ...patch };
  setUI({ xray: { ...x, plans } });
}

export function resetXRayChoices() {
  const x = useUI.getState().xray;
  if (!x) return;
  const plans = [...x.plans];
  plans[x.index] = recommendedPlan(x.reports[x.index]);
  setUI({ xray: { ...x, plans } });
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

export async function openProjectFile(file: File) {
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
  setUI({ parts: [], joints: [], reports: {}, selection: null, draft: null, cutCheck: null, hover: null, xray: null, connectorEdit: null, tool: 'select', explode: 0 });
}

export async function newProject() {
  resetView();
  const doc = createProject();
  useHistory.getState().load(doc);
  await saveDocNow(doc);
  await pruneMeshes(new Set());
}
