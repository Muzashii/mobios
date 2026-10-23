import { openDB, type IDBPDatabase } from 'idb';
import type { MeshData } from '../geometry/types';
import type { ProjectDoc } from './project';

const DB_NAME = 'fenda-studio';
const CURRENT = 'current';

let dbPromise: Promise<IDBPDatabase> | null = null;
const db = () =>
  (dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('docs');
      d.createObjectStore('meshes');
    },
  }));

/** Source meshes in memory (needed for `.fenda` export and worker restarts). */
export const sourceMeshes = new Map<string, MeshData>();

export async function saveMesh(id: string, mesh: MeshData) {
  sourceMeshes.set(id, mesh);
  try {
    await (await db()).put('meshes', mesh, id);
  } catch (e) {
    console.warn('IndexedDB indisponível; malha mantida só em memória.', e);
  }
}

let docTimer: ReturnType<typeof setTimeout> | undefined;
/** Debounced autosave of the current project document. */
export function saveDocSoon(doc: ProjectDoc) {
  clearTimeout(docTimer);
  docTimer = setTimeout(() => void saveDocNow(doc), 400);
}

export async function saveDocNow(doc: ProjectDoc) {
  clearTimeout(docTimer);
  try {
    await (await db()).put('docs', doc, CURRENT);
    return true;
  } catch {
    return false;
  }
}

export async function loadCurrent(): Promise<{ doc: ProjectDoc; meshes: Record<string, MeshData> } | null> {
  try {
    const d = await db();
    const doc = (await d.get('docs', CURRENT)) as ProjectDoc | undefined;
    if (!doc || doc.schema !== 1) return null;
    const meshes: Record<string, MeshData> = {};
    for (const s of doc.sources) {
      const m = (await d.get('meshes', s.id)) as MeshData | undefined;
      if (m) {
        meshes[s.id] = m;
        sourceMeshes.set(s.id, m);
      }
    }
    return { doc, meshes };
  } catch {
    return null;
  }
}

/** Drops meshes no document references anymore. */
export async function pruneMeshes(keep: Set<string>) {
  try {
    const d = await db();
    for (const key of await d.getAllKeys('meshes')) {
      if (!keep.has(String(key))) await d.delete('meshes', key);
    }
    for (const id of [...sourceMeshes.keys()]) if (!keep.has(id)) sourceMeshes.delete(id);
  } catch {
    // Best effort.
  }
}
