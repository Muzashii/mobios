import { CONNECTOR_TYPES, TOLERANCE_PRESETS } from '../../geometry/connectors';
import type { Operation } from '../../geometry/types';
import { setClearance } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { setUI, useUI } from '../../store/ui';
import { Button, Field, NumberInput, Section, cx } from '../../ui/components';
import { IconAlert, IconAssembly, IconCheck, IconPin, IconRuler } from '../../ui/icons';
import { toggleAssembly } from '../../app/commands';
import { editConnector, editCut } from '../cut/cutActions';
import { addCalibration } from '../import/importActions';
import { StepEmpty, StepHeader } from './StepHeader';

type ConnectorOp = Extract<Operation, { kind: 'connector' }>;

/** Step 3: the joints — one row per cut with its pin, the clearance and the assembly check. */
export function FitStep() {
  const joints = useUI((s) => s.joints);
  const ops = useHistory((s) => s.doc.operations);
  const tech = useHistory((s) => s.doc.technology);
  const clearance = useHistory((s) => s.doc.clearance[tech]);
  const assembling = useUI((s) => s.assembly !== null);
  const reports = useUI((s) => s.reports);
  const connectors = new Map(ops.filter((o): o is ConnectorOp => o.kind === 'connector').map((o) => [o.joint, o]));

  return (
    <div className="h-full overflow-y-auto">
      <StepHeader n={3} title="Encaixes" text="Cada junta ganha um pino com folga. Ajuste o tipo e confira a montagem." />
      {joints.length === 0 ? (
        <StepEmpty>
          Ainda não há juntas. Separe o modelo primeiro.
          <div className="mt-3">
            <Button size="sm" onClick={() => setUI({ step: 'split' })}>
              Ir para Separar
            </Button>
          </div>
        </StepEmpty>
      ) : (
        <Section title={`Juntas · ${joints.length}`}>
          <ul className="space-y-1" aria-label="Juntas">
            {joints.map((j) => {
              const k = connectors.get(j.id);
              const type = k ? (CONNECTOR_TYPES.find((t) => t.value === k.type)?.label ?? k.type) : null;
              const rep = k ? reports[k.id] : undefined;
              const problem = rep?.error ?? (rep?.info?.includes('não aplicado') ? (rep.warnings[0] ?? 'O pino não coube nesta junta.') : undefined);
              return (
                <li key={j.id}>
                  <button
                    className="flex w-full items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-2 text-left hover:bg-surface-3"
                    onMouseEnter={() => setUI({ hovered: j.b })}
                    onMouseLeave={() => setUI({ hovered: null })}
                    onClick={() => (k ? editConnector(k.id) : void editCut(j.id))}
                  >
                    <span className="num flex size-6 items-center justify-center rounded-md bg-accent-soft text-[11px] font-semibold text-accent">{j.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{k ? `${type} ${k.params.diameter} mm` : 'Sem encaixe'}</span>
                      <span className={cx('block text-[11px]', problem ? 'text-warning' : 'text-muted')} title={problem}>
                        {problem ? 'não coube — clique para ajustar' : k ? `folga ${k.params.clearance} mm` : j.planar || j.faceRadius ? 'clique para adicionar' : 'junta curva: sem lugar para pino'}
                      </span>
                    </span>
                    {j.assemblyClear !== undefined && (
                      <span className={cx('flex items-center gap-1 text-[11px]', j.assemblyClear ? 'text-success' : 'text-danger')}>
                        {j.assemblyClear ? <IconCheck size={13} /> : <IconAlert size={13} />}
                        {j.assemblyClear ? 'ok' : 'colide'}
                      </span>
                    )}
                    <IconPin size={14} className="text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button className="w-full" onClick={toggleAssembly} data-testid="simulate-assembly">
            <IconAssembly size={15} /> {assembling ? 'Fechar simulação' : 'Simular montagem'}
          </Button>
        </Section>
      )}
      <Section title="Folga padrão">
        <Field label={`${TOLERANCE_PRESETS[tech].label} (mm)`} hint={`Faixa recomendada: ${TOLERANCE_PRESETS[tech].range.join('–')} mm`}>
          {(id) => <NumberInput id={id} value={clearance} min={0} max={1} step={0.01} onChange={(v) => dispatch(setClearance(tech, v))} />}
        </Field>
        <p className="text-[11px] leading-snug text-muted">
          Recomendado {TOLERANCE_PRESETS[tech].range.join('–')} mm. Na dúvida, imprima a peça de calibração e escolha a folga que encaixa firme.
        </p>
        <Button size="sm" className="w-full" onClick={() => void addCalibration()}>
          <IconRuler size={14} /> Gerar peça de calibração
        </Button>
      </Section>
    </div>
  );
}
