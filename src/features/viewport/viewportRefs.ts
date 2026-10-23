import type { Camera } from 'three';

/** The live camera and canvas, for DOM-level tools (free-hand stroke) living outside the Canvas. */
export const viewportRefs = {
  camera: null as Camera | null,
  canvas: null as HTMLCanvasElement | null,
};
