import type { CrossSection, Manifold, Mat4 } from 'manifold-3d';
import { jointFaceIslands, type JointGeometry } from './connectors';
import { dropSlivers } from './cut';
import { placeLabel } from './placement';
import type { Vec2 } from './types';
import type { Wasm } from './wasm';

// Seven-segment stroke font: robust to print as a shallow engraving at small sizes.
// Cell is 0.6 wide × 1 tall; segments a..g in the classic order.
const S: Record<string, [Vec2, Vec2]> = {
  a: [[0, 1], [0.6, 1]],
  b: [[0.6, 1], [0.6, 0.5]],
  c: [[0.6, 0.5], [0.6, 0]],
  d: [[0, 0], [0.6, 0]],
  e: [[0, 0], [0, 0.5]],
  f: [[0, 0.5], [0, 1]],
  g: [[0, 0.5], [0.6, 0.5]],
};
const GLYPHS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  A: 'abcefg', B: 'fgedc', C: 'afed', D: 'bcdeg', E: 'afged', F: 'afge', H: 'fbgec', J: 'bcde', L: 'fed', P: 'abfge', U: 'fedcb',
};

export const LABEL_CHARS = Object.keys(GLYPHS).join('');

/** Text as a 2D shape centred on the origin; `size` is the cap height (mm). */
export function textShape(wasm: Wasm, text: string, size: number): { shape: CrossSection; width: number; height: number } {
  const stroke = size * 0.16;
  const advance = size * 0.6 + size * 0.32;
  const chars = [...text.toUpperCase()].filter((ch) => GLYPHS[ch]);
  if (!chars.length) throw new Error('Texto da numeração sem caracteres suportados.');
  const width = chars.length * advance - size * 0.32;
  const parts: CrossSection[] = [];
  chars.forEach((ch, i) => {
    for (const seg of GLYPHS[ch]) {
      const [[x0, y0], [x1, y1]] = S[seg];
      const p0: Vec2 = [i * advance + x0 * size - width / 2, y0 * size - size / 2];
      const p1: Vec2 = [i * advance + x1 * size - width / 2, y1 * size - size / 2];
      const c0 = wasm.CrossSection.circle(stroke / 2, 12).translate(p0);
      const c1 = wasm.CrossSection.circle(stroke / 2, 12).translate(p1);
      parts.push(wasm.CrossSection.hull([c0, c1]));
      c0.delete();
      c1.delete();
    }
  });
  const shape = wasm.CrossSection.union(parts);
  parts.forEach((p) => p.delete());
  return { shape, width: width + stroke, height: size + stroke };
}

/**
 * Engraves the joint label (e.g. "J1") into both cut faces, in a spot kept clear of
 * connectors. On B the text is mirrored so it reads correctly when looking at that face.
 */
export function engraveLabel(
  wasm: Wasm,
  a: Manifold,
  b: Manifold,
  joint: JointGeometry & { obstacles: { c: Vec2; r: number }[] },
  text: string,
  size: number,
  depth: number,
): { a: Manifold; b: Manifold; size: number } {
  const { islands, frame } = jointFaceIslands(b, joint, wasm);
  if (!islands.length) throw new Error('Face de corte não encontrada para a numeração.');
  const island = islands.reduce((x, y) => (y.area > x.area ? y : x));

  for (let s = size; s >= Math.min(size, 3) - 1e-9; s *= 0.8) {
    const { shape, width, height } = textShape(wasm, text, s);
    const pos = placeLabel(island.polys, joint.obstacles, Math.hypot(width, height) / 2 + 0.8);
    if (!pos) {
      shape.delete();
      if (s * 0.8 < 3) break;
      continue;
    }
    const toWorld = frame.toWorld as Mat4;
    const cut = (cs: CrossSection, z0: number, z1: number) => {
      const solid = cs.extrude(z1 - z0).translate([pos[0], pos[1], z0]);
      const world = solid.transform(toWorld);
      solid.delete();
      return world;
    };
    const mirrored = shape.mirror([1, 0]);
    const cutA = cut(shape, -depth, 0.1);
    const cutB = cut(mirrored, -0.1, depth);
    const na = dropSlivers(wasm, a.subtract(cutA));
    const nb = dropSlivers(wasm, b.subtract(cutB));
    [shape, mirrored, cutA, cutB].forEach((m) => m.delete());
    return { a: na, b: nb, size: s };
  }
  throw new Error('Sem espaço livre na face para gravar a numeração.');
}
