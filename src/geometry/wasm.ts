import Module, { type ManifoldToplevel } from 'manifold-3d';

export type Wasm = ManifoldToplevel;

let loading: Promise<Wasm> | null = null;

/** Loads manifold-3d once. `wasmUrl` is required in the browser (Vite asset URL). */
export function loadManifold(wasmUrl?: string): Promise<Wasm> {
  loading ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((wasm) => {
    wasm.setup();
    wasm.setCircularSegments(0);
    wasm.setMinCircularAngle(7.5);
    wasm.setMinCircularEdgeLength(0.4);
    return wasm;
  });
  return loading;
}
