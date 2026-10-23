import type { Operation } from '../../geometry/types';
import { removeOperation, updateOperation } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { setUI, useUI } from '../../store/ui';
import { Button, Section } from '../../ui/components';
import { IconTrash } from '../../ui/icons';
import { ConnectorFields } from './ConnectorFields';

/** Edits an existing connector operation; each change recomputes live (coalesced into one undo step). */
export function ConnectorInspector({ opId }: { opId: string }) {
  const op = useHistory((s) => s.doc.operations.find((o) => o.id === opId)) as Extract<Operation, { kind: 'connector' }> | undefined;
  const joint = useUI((s) => s.joints.find((j) => j.id === op?.joint));
  const report = useUI((s) => s.reports[opId]);
  if (!op) return null;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={`Encaixe ${joint?.label ?? ''}`} aside={report?.info && <span className="text-[11px] text-success">{report.info}</span>}>
          {report?.error && <p className="rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{report.error}</p>}
          {report?.warnings.map((w) => (
            <p key={w} className="rounded-md bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              {w}
            </p>
          ))}
          <ConnectorFields
            value={{ type: op.type, params: op.params }}
            onChange={(v) => dispatch(updateOperation({ ...op, ...v }, 'Editar encaixe', `connector-${op.id}`))}
          />
        </Section>
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button
          variant="danger"
          onClick={() => {
            dispatch(removeOperation(op.id, 'Remover encaixe'));
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
