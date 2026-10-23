import { geometry } from '../geometry/client';
import { useHistory } from '../store/history';
import { loadCurrent } from '../store/persistence';
import { requestEvaluate, startSync } from '../store/sync';
import { focus, setUI, toast } from '../store/ui';

/** Starts the worker, restores the autosaved project and wires sync. */
export async function bootstrap() {
  const t0 = performance.now();
  const saved = await loadCurrent();
  const warmUp = async () => {
    try {
      await geometry().ping(); // loads WASM in the worker
    } catch (e) {
      toast('error', 'Motor geométrico não carregou', e instanceof Error ? e.message : String(e), 15000);
    }
  };
  if (saved?.doc.sources.length) await warmUp();
  else whenIdle(() => void warmUp()); // fresh start: don't compete with the first paint
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
  listenForLaunchedFiles();
}

/** Runs after the page has loaded and the main thread is idle. */
function whenIdle(cb: () => void) {
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

/** Installed PWA: models opened from the file manager (manifest file_handlers) arrive here. */
function listenForLaunchedFiles() {
  const queue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  queue?.setConsumer(async (params) => {
    if (!params.files.length) return;
    const files = await Promise.all(params.files.map((f) => f.getFile()));
    const { importFiles } = await import('../features/import/importActions');
    await importFiles(files);
  });
}
