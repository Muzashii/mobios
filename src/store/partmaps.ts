import { geometry } from '../geometry/client';
import { useHistory } from './history';
import { toast, useUI } from './ui';

/**
 * Keeps the automatic part maps of the parts that show one in step with their meshes: computed
 * in the worker when shown, again whenever the part's mesh changes (new version).
 */
export function ensurePartMaps() {
  const { doc } = useHistory.getState();
  const { parts, partMaps } = useUI.getState();
  for (const id of Object.keys(doc.partMaps ?? {})) {
    const part = parts.find((p) => p.id === id);
    if (!part) continue;
    const cache = partMaps[id];
    if (cache && cache.version === part.version) continue;
    void compute(id, part.version);
  }
}

async function compute(id: string, version: number) {
  useUI.setState((s) => ({ partMaps: { ...s.partMaps, [id]: { version, status: 'pending' } } }));
  const busyTimer = setTimeout(() => useUI.setState({ busy: true, busyLabel: 'Detectando partes…' }), 120);
  try {
    const result = await geometry().partMap(id);
    // A newer version may have been requested meanwhile; keep only the matching one.
    if (useUI.getState().partMaps[id]?.version !== version) return;
    useUI.setState((s) => ({ partMaps: { ...s.partMaps, [id]: { version, status: 'ready', result } } }));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    useUI.setState((s) => ({ partMaps: { ...s.partMaps, [id]: { version, status: 'error', error } } }));
    toast('error', 'Não consegui detectar as partes', error);
  } finally {
    clearTimeout(busyTimer);
    useUI.setState({ busy: false });
  }
}
