import { beforeEach, describe, expect, it } from 'vitest';
import type { Operation } from '../../src/geometry/types';
import { addOperation, addSources, removeWithDependents, renameProject } from '../../src/store/commands';
import { useHistory } from '../../src/store/history';
import { createProject } from '../../src/store/project';

const cut = (id: string, target: string): Operation => ({ kind: 'cut-plane', id, target, plane: { origin: [0, 0, 0], normal: [0, 0, 1] } });

describe('commands + undo/redo', () => {
  beforeEach(() => useHistory.getState().load(createProject()));

  it('undoes and redoes every command', () => {
    const { dispatch } = useHistory.getState();
    dispatch(addSources([{ id: 's1', name: 'Dragão' }]));
    dispatch(addOperation(cut('c1', 's1'), 'Corte'));
    expect(useHistory.getState().doc.name).toBe('Dragão');
    expect(useHistory.getState().doc.operations).toHaveLength(1);

    useHistory.getState().undo();
    expect(useHistory.getState().doc.operations).toHaveLength(0);
    useHistory.getState().undo();
    expect(useHistory.getState().doc.sources).toHaveLength(0);
    useHistory.getState().redo();
    useHistory.getState().redo();
    expect(useHistory.getState().doc.operations).toHaveLength(1);
  });

  it('coalesces rapid edits into one undo step', () => {
    const { dispatch } = useHistory.getState();
    dispatch(renameProject('A'));
    dispatch(renameProject('AB'));
    dispatch(renameProject('ABC'));
    expect(useHistory.getState().past).toHaveLength(1);
    useHistory.getState().undo();
    expect(useHistory.getState().doc.name).toBe('Sem título');
  });

  it('removing a cut removes what depends on it, keeps the rest', () => {
    const ops: Operation[] = [
      cut('c1', 's1'),
      { kind: 'connector', id: 'k1', joint: 'c1', type: 'pin', params: { diameter: 5, depth: 6, clearance: 0.2, chamfer: 0.4, minWall: 1.2, count: 'auto', maleSide: 'a' } },
      cut('c2', 'c1.b'),
      cut('c3', 'c2.a'),
      cut('c4', 's2'),
    ];
    expect(removeWithDependents(ops, 'c1').map((o) => o.id)).toEqual(['c4']);
    expect(removeWithDependents(ops, 'c2').map((o) => o.id)).toEqual(['c1', 'k1', 'c4']);
  });
});

describe('excluir modelo', () => {
  it('removes a mesh with every cut made from it, from any of its pieces', async () => {
    const { createProject } = await import('../../src/store/project');
    const { addOperation, removeSource, sourceOf } = await import('../../src/store/commands');
    let doc = createProject();
    doc = { ...doc, sources: [{ id: 'fig', name: 'Figura' }, { id: 'out', name: 'Outro' }] as typeof doc.sources };
    const plane = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    doc = addOperation({ kind: 'cut-plane', id: 'c1', target: 'fig', plane }, 'corte').apply(doc);
    doc = addOperation({ kind: 'cut-region', id: 'c2', target: 'c1.b', balls: [], seeds: [], level: 1, mode: 'auto', plane } as never, 'smartcut').apply(doc);
    doc = addOperation({ kind: 'connector', id: 'k1', joint: 'c2', type: 'pin', params: {} } as never, 'pino').apply(doc);
    doc = addOperation({ kind: 'cut-plane', id: 'c3', target: 'out', plane }, 'corte').apply(doc);
    expect(sourceOf(doc, 'c2.a')).toBe('fig');
    expect(sourceOf(doc, 'c3.b')).toBe('out');
    expect(sourceOf(doc, 'k1.pins')).toBeNull();
    const after = removeSource('fig', 'Figura').apply(doc);
    expect(after.sources.map((s) => s.id)).toEqual(['out']);
    expect(after.operations.map((o) => o.id)).toEqual(['c3']);
  });
});
