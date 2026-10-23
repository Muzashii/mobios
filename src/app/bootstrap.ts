import { geometry } from '../geometry/client';
import { useHistory } from '../store/history';
import { loadCurrent } from '../store/persistence';
import { requestEvaluate, startSync } from '../store/sync';
import { focus, setUI, toast } from '../store/ui';

/** Starts the worker, restores the autosaved project and wires sync. */
export async function bootstrap() {
  const t0 = performance.now();
  try {
    await geometry().ping(); // loads WASM in the worker
  } catch (e) {
    toast('error', 'Motor geométrico não carregou', e instanceof Error ? e.message : String(e), 15000);
  }
  const saved = await loadCurrent();
  if (saved && saved.doc.sources.length) {
    for (const [id, mesh] of Object.entries(saved.meshes)) await geometry().registerSource(id, mesh);
    useHistory.getState().load(saved.doc);
  }
  startSync();
  setUI({ ready: true });
  if (saved?.doc.sources.length) {
    requestEvaluate(true);
    setTimeout(() => focus('all'), 400);
    toast('info', `Projeto "${saved.doc.name}" restaurado`, `Pronto em ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
  }
}
