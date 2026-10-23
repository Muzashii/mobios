import { beforeAll, describe, expect, it } from 'vitest';
import { decodeModel, packProject, unpackProject } from '../../src/io';
import { parseOBJ, writeOBJ } from '../../src/io/obj';
import { parseSTL, writeSTL } from '../../src/io/stl';
import { parse3MF, write3MF } from '../../src/io/threemf';
import { repairMesh, weldVertices } from '../../src/geometry/repair';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';
import { GeometryService } from '../../src/geometry/service';
import { asciiSTL, boxMesh, toSoup } from '../fixtures/meshes';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

const buf = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

describe('STL', () => {
  it('binary round-trip', () => {
    const box = boxMesh(10);
    const soup = parseSTL(buf(writeSTL(box)));
    expect(soup).toEqual(toSoup(box));
  });
  it('parses ASCII', () => {
    const soup = parseSTL(buf(new TextEncoder().encode(asciiSTL(boxMesh(4)))));
    expect(soup.length).toBe(12 * 9);
  });
});

describe('OBJ', () => {
  it('round-trip with quads and groups', () => {
    const obj = 'o A\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\ng B\nf -4 -3 -2\n';
    const meshes = parseOBJ(obj);
    expect(meshes.map((m) => m.name)).toEqual(['A', 'B']);
    expect(meshes[0].mesh.indices.length).toBe(6);
    const again = parseOBJ(writeOBJ(boxMesh(2), 'Cubo'));
    expect(again[0].name).toBe('Cubo');
    expect(again[0].mesh.indices.length).toBe(36);
  });
});

describe('3MF', () => {
  it('writes one object per part with Bambu filament slots, and reads it back', () => {
    const data = write3MF([
      { name: 'Parte A', mesh: boxMesh(10), color: '#ff6b2c', slot: 1 },
      { name: 'Parte B', mesh: boxMesh(10, [30, 0, 0]), color: '#3fa7ff', slot: 3 },
    ]);
    const parts = parse3MF(data);
    expect(parts.map((p) => p.name)).toEqual(['Parte A', 'Parte B']);
    expect(parts[1].mesh.indices.length).toBe(36);
    // Grid layout puts every part on the bed (z >= 0).
    expect(Math.min(...parts[1].mesh.positions.filter((_, i) => i % 3 === 2))).toBeCloseTo(0, 5);
    const text = new TextDecoder().decode(data);
    expect(text).toContain('model_settings.config');
  });
});

describe('repair', () => {
  it('welds an STL soup into an indexed closed mesh', () => {
    const welded = weldVertices(toSoup(boxMesh(10)));
    expect(welded.positions.length).toBe(8 * 3);
    const { manifold, report } = repairMesh(wasm, toSoup(boxMesh(10)));
    expect(manifold.volume()).toBeCloseTo(1000, 3);
    expect(report).toEqual([]);
    manifold.delete();
  });

  it('closes a hole, fixes a flipped face and drops duplicates', () => {
    const box = boxMesh(10);
    const t = Array.from(box.indices);
    t.splice(0, 3); // remove one bottom triangle -> hole
    [t[3], t[4]] = [t[4], t[3]]; // flip a top triangle
    t.push(...t.slice(6, 9)); // duplicate a face
    const { manifold, report } = repairMesh(wasm, box.positions, Uint32Array.from(t));
    expect(manifold.status()).toBe('NoError');
    expect(manifold.volume()).toBeCloseTo(1000, 3);
    expect(report.join(' ')).toMatch(/buraco/);
    expect(report.join(' ')).toMatch(/invertida/);
    expect(report.join(' ')).toMatch(/duplicada/);
    manifold.delete();
  });

  it('fixes a fully inside-out mesh', () => {
    const box = boxMesh(10);
    const t = Array.from(box.indices);
    for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]];
    const { manifold } = repairMesh(wasm, box.positions, Uint32Array.from(t));
    expect(manifold.volume()).toBeCloseTo(1000, 3);
    manifold.delete();
  });

  it('merges overlapping shells', () => {
    const a = boxMesh(10), b = boxMesh(10, [5, 0, 0]);
    const positions = new Float32Array([...a.positions, ...b.positions]);
    const indices = new Uint32Array([...a.indices, ...Array.from(b.indices, (i) => i + 8)]);
    const { manifold, report } = repairMesh(wasm, positions, indices);
    expect(manifold.volume()).toBeCloseTo(1500, 2);
    expect(report.join(' ')).toMatch(/sobrepostas/);
    manifold.delete();
  });
});

describe('import + export pipeline', () => {
  it('imports an STL, cuts it and exports all formats', () => {
    const service = new GeometryService(wasm);
    const stl = buf(writeSTL(boxMesh(20)));
    const [src] = service.importFile('Cubo.stl', stl, 'src1');
    expect(src.name).toBe('Cubo');
    const res = service.evaluate([{ id: src.id, name: src.name }], [
      { kind: 'cut-plane', id: 'c1', target: src.id, plane: { origin: [0, 0, 0], normal: [1, 0, 0] } },
    ]);
    expect(res.parts).toHaveLength(2);
    const parts = res.parts.map((p, i) => ({ id: p.id, name: p.name, color: '#ffffff', slot: i + 1 }));
    for (const format of ['stl-zip', 'obj-zip', '3mf'] as const) {
      expect(service.exportParts(format, parts).byteLength).toBeGreaterThan(100);
    }
    const back = decodeModel('x.3mf', buf(service.exportParts('3mf', parts)));
    expect(back).toHaveLength(2);
    service.engine.dispose();
  });

  it('.fenda project pack/unpack', () => {
    const doc = { name: 'Teste', operations: [] };
    const box = boxMesh(3);
    const { doc: d, meshes } = unpackProject<typeof doc>(packProject(doc, { s1: box }));
    expect(d).toEqual(doc);
    expect(meshes.s1.positions).toEqual(box.positions);
    expect(meshes.s1.indices).toEqual(box.indices);
  });
});
