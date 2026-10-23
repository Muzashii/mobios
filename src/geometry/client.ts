import * as Comlink from 'comlink';
import type { GeometryApi } from './worker';

let remote: Comlink.Remote<GeometryApi> | null = null;

/** Lazily spawns the geometry worker (the WASM loads there, off the UI thread). */
export function geometry(): Comlink.Remote<GeometryApi> {
  if (!remote) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'mobios-geometry' });
    remote = Comlink.wrap<GeometryApi>(worker);
  }
  return remote;
}
