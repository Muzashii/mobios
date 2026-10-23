import type { Operation } from '../../geometry/types';
import { removeOperation, updateOperation } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { setUI, useUI } from '../../store/ui';
import { Button, Field, NumberInput, Section } from '../../ui/components';
import { IconTrash } from '../../ui/icons';

/** Engraved joint number ("J1" on both faces): size and depth. */
export function LabelInspector({ opId }: { opId: string }) {
  const op = useHistory((s) => s.doc.operations.find((o) => o.id === opId)) as Extract<Operation, { kind: 'label' }> | undefined;
  const joint = useUI((s) => s.joints.find((j) => j.id === op?.joint));
  const report = useUI((s) => s.reports[opId]);
  if (!op) return null;
  const set = (patch: Partial<typeof op>) => dispatch(updateOperation({ ...op, ...patch }, 'Editar numeração', `label-${op.id}`));
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={`Numeração ${joint?.label ?? ''}`} aside={report?.info && <span className="truncate text-[11px] text-success">✓</span>}>
          {report?.error && <p className="rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{report.error}</p>}
          {report?.warnings.map((w) => (
            <p key={w} className="rounded-md bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              {w}
            </p>
          ))}
          <p className="text-[11px] leading-snug text-muted">
            O código da junta é gravado em baixo-relevo nas duas faces de corte, longe dos encaixes, para você não errar a montagem.
          </p>
          <Field label="Altura do texto">{(id) => <NumberInput id={id} value={op.size} min={3} max={40} step={0.5} digits={1} onChange={(size) => set({ size })} />}</Field>
          <Field label="Profundidade">{(id) => <NumberInput id={id} value={op.depth} min={0.2} max={3} step={0.1} digits={1} onChange={(depth) => set({ depth })} />}</Field>
        </Section>
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button
          variant="danger"
          onClick={() => {
            dispatch(removeOperation(op.id, 'Remover numeração'));
            setUI({ connectorEdit: null });
          }}
        >
          <IconTrash size={15} /> Remover
        </Button>
        <Button variant="subtle" className="flex-1" onClick={() => setUI({ connectorEdit: null })}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
