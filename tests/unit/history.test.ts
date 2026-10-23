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
