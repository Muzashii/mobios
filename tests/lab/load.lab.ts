import fs from 'node:fs';
import { it } from 'vitest';
import { decodeModel } from '../../src/io';
import { manifoldToMeshData, repairMesh } from '../../src/geometry/repair';
import { loadManifold } from '../../src/geometry/wasm';

const MODEL = process.env.MOBIOS_LAB_MODEL ?? '';
const OUT = process.env.MOBIOS_LAB_OUT ?? '';

it.skipIf(!MODEL)('model stats', async () => {
  const wasm = await loadManifold();
  const buf = fs.readFileSync(MODEL);
  let t = performance.now();
  const [raw] = decodeModel('m.stl', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  console.log('decode', (performance.now() - t).toFixed(0), 'ms', raw.positions.length / 9, 'tris');
  t = performance.now();
  const { manifold, report } = repairMesh(wasm, raw.positions, raw.indices);
  console.log('repair', (performance.now() - t).toFixed(0), 'ms', report);
  const b = manifold.boundingBox();
  console.log('tris', manifold.numTri(), 'bbox', b.min.map((v) => v.toFixed(1)), b.max.map((v) => v.toFixed(1)));
  console.log('volume', (manifold.volume() / 1000).toFixed(1), 'cm3 genus', manifold.genus(), 'bodies', manifold.decompose().length);
  if (OUT) {
    const m = manifoldToMeshData(manifold);
    fs.writeFileSync(`${OUT}/full.pos.bin`, Buffer.from(m.positions.buffer));
    fs.writeFileSync(`${OUT}/full.idx.bin`, Buffer.from(m.indices.buffer));
    for (const target of [200_000, 60_000]) {
      t = performance.now();
      const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      let tol = diag * 1e-4;
      let s = manifold.simplify(tol);
      while (s.numTri() > target) {
        tol *= 1.6;
        s.delete();
        s = manifold.simplify(tol);
      }
      const sm = manifoldToMeshData(s);
      console.log('simplify →', s.numTri(), 'tris tol', tol.toFixed(3), (performance.now() - t).toFixed(0), 'ms');
      fs.writeFileSync(`${OUT}/p${target}.pos.bin`, Buffer.from(sm.positions.buffer));
      fs.writeFileSync(`${OUT}/p${target}.idx.bin`, Buffer.from(sm.indices.buffer));
      s.delete();
    }
  }
});
