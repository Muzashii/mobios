import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConnectorParams } from '../../src/geometry/connectors';
import { Engine } from '../../src/geometry/engine';
import { partMapOf } from '../../src/geometry/partmap';
import { exampleFigure } from '../../src/geometry/primitives';
import { manifoldToMeshData } from '../../src/geometry/repair';
import type { Operation, Vec3 } from '../../src/geometry/types';
import { mapGroups, peelOrder } from '../../src/features/parts/groups';
import { loadManifold, type Wasm } from '../../src/geometry/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadManifold();
});

describe('separar em todas as partes', () => {
  it('peels the figure from the outside in and cuts every part off, each with a pin and a number', () => {
    const fig = exampleFigure(wasm);
    const mesh = manifoldToMeshData(fig);
    const map = partMapOf(fig);
    const edits = { names: {}, merged: {} };
    const groups = mapGroups(map, edits);
    const order = peelOrder(map, edits, groups);
    expect(order).toHaveLength(groups.length - 1);

    // One point per part: the face of that part closest to its mean (as the app does).
    const centre = (f: number) => [0, 1, 2].map((k) => (0 + [0, 1, 2].reduce((s, j) => s + mesh.positions[mesh.indices[f * 3 + j] * 3 + k], 0)) / 3) as Vec3;
    const seedOf = (label: number): Vec3 => {
      const faces = [...map.labels.keys()].filter((f) => map.labels[f] === label);
      const mean = [0, 1, 2].map((k) => faces.reduce((s, f) => s + centre(f)[k], 0) / faces.length);
      return faces.map(centre).sort((a, b) => Math.hypot(a[0] - mean[0], a[1] - mean[1], a[2] - mean[2]) - Math.hypot(b[0] - mean[0], b[1] - mean[1], b[2] - mean[2]))[0];
    };

    const ops: Operation[] = [];
    let target = 'fig';
    order.forEach((g, i) => {
      const id = `c${i}`;
      const seeds = [seedOf(g)];
      ops.push({ kind: 'cut-region', id, target, balls: [], seeds, partSeeds: seeds, mapFrom: 'fig', level: 0, mode: 'surface', plane: { origin: seeds[0], normal: [0, 0, 1] }, name: groups.find((x) => x.id === g)!.name });
      ops.push({ kind: 'connector', id: `k${i}`, joint: id, type: 'pin', params: defaultConnectorParams('FDM') });
      ops.push({ kind: 'label', id: `l${i}`, joint: id, size: 6, depth: 0.6 });
      target = `${id}.a`;
    });

    const engine = new Engine(wasm);
    engine.addSource('fig', fig);
    const r = engine.evaluate([{ id: 'fig', name: 'Figura' }], ops);
    for (const op of ops.filter((o) => o.kind !== 'connector')) expect(r.reports[op.id].error, `${op.id}: ${r.reports[op.id].error}`).toBeUndefined();
    expect(r.parts.filter((p) => !p.id.endsWith('.pins')).length).toBe(groups.length);
    engine.dispose();
  }, 300_000);
});
