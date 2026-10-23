import { useEffect, useState } from 'react';
import { geometry } from '../../geometry/client';
import type { OrientationSuggestion, PrintabilityReport } from '../../geometry/printability';
import type { Operation } from '../../geometry/types';
import { addOperation, batch, removeOperation, setPartMeta, updateOperation } from '../../store/commands';
import { dispatch, getDoc, useHistory } from '../../store/history';
import { newId, printerOf } from '../../store/project';
import { setUI, toast, useUI, type ViewPart } from '../../store/ui';
import { Button, Field, NumberInput, Section, mm } from '../../ui/components';
import { IconAlert, IconCheck, IconCut } from '../../ui/icons';

/** Splits the part with the fewest axis cuts so every piece fits the selected printer. */
export async function autoSplitPart(partId: string) {
  const doc = getDoc();
  const printer = printerOf(doc);
  setUI({ busy: true, busyLabel: `Dividindo para a ${printer.name}…` });
  try {
    const plan = await geometry().autoSplit(partId, printer.volume, doc.technology);
    if (!plan.ops.length) {
      toast('info', 'A peça já cabe na mesa', printer.name);
      return;
    }
    dispatch(batch(`Dividir para a ${printer.name}`, plan.ops.map((op) => addOperation(op, 'Corte automático'))));
    setUI({ selection: null });
    toast('success', `${plan.pieces} partes, ${plan.cuts} corte(s)`, `Cada parte cabe na ${printer.name}. Pinos soltos e numeração adicionados.`);
  } catch (e) {
    toast('error', 'Não foi possível dividir', e instanceof Error ? e.message : String(e));
  } finally {
    setUI({ busy: false });
  }
}

function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted">{label}</span>
      <span className={`num ${bad ? 'text-warning' : 'text-text'}`}>{value}</span>
    </div>
  );
}

function ReportView({ r }: { r: PrintabilityReport }) {
  return (
    <div className="space-y-1 rounded-md bg-surface-2 px-2 py-1.5">
      <Metric label="Balanço > 45° (suporte)" value={`${mm(r.overhangArea / 100, 1)} cm² · ${r.overhangPct.toFixed(0)}%`} bad={r.overhangPct > 10} />
      <Metric label="Área apoiada na mesa" value={`${mm(r.baseArea / 100, 1)} cm²`} bad={r.baseArea < 1} />
      <Metric label="Altura de impressão" value={`${mm(r.height, 1)} mm`} />
      <Metric label="Parede mais fina" value={`${mm(r.minThickness, 2)} mm`} bad={r.minThickness < r.thinLimit} />
      {r.thinPct > 0 && <Metric label={`Área com parede < ${r.thinLimit} mm`} value={`${r.thinPct.toFixed(0)}%`} bad />}
    </div>
  );
}

/** Printability analysis, suggested orientation, bed fit and resin hollowing for one part. */
export function PrintPrep({ part, fits }: { part: ViewPart; fits: boolean }) {
  const doc = useHistory((s) => s.doc);
  const meta = doc.partMeta[part.id] ?? {};
  const [report, setReport] = useState<PrintabilityReport | null>(null);
  const [orient, setOrient] = useState<OrientationSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [hollow, setHollow] = useState({ wall: 2, drainDiameter: 3, drainCount: 2 });
  const hollowOp = useHistory((s) => s.doc.operations.find((o) => o.kind === 'hollow' && o.target === part.id));
  const printer = printerOf(doc);

  useEffect(() => {
    setReport(null);
    setOrient(null);
  }, [part.id, part.version]);

  const analyze = async () => {
    setLoading(true);
    try {
      const [r, o] = await Promise.all([geometry().analyze(part.id, doc.technology), geometry().orientation(part.id, doc.technology)]);
      setReport(r);
      setOrient(o);
    } catch (e) {
      toast('error', 'Falha na análise', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const applyHollow = () => {
    const op: Operation = { kind: 'hollow', id: newId('h'), target: part.id, ...hollow };
    dispatch(addOperation(op, 'Oco para resina'));
    toast('info', 'Calculando o oco…', 'Pode levar alguns segundos em peças grandes.');
  };

  return (
    <>
      {!fits && (
        <Section title="Mesa de impressão">
          <p className="text-[11px] leading-snug text-muted">
            Esta parte não cabe na {printer.name}. O auto-split faz o menor número de cortes possível, escolhendo as seções mais estreitas, e adiciona pinos soltos e numeração.
          </p>
          <Button size="sm" variant="primary" className="w-full" onClick={() => void autoSplitPart(part.id)} data-testid="auto-split">
            <IconCut size={14} /> Dividir para caber na mesa
          </Button>
        </Section>
      )}

      <Section title="Análise de impressão" aside={meta.down && <span className="text-[11px] text-success">orientação definida</span>}>
        {!report ? (
          <Button size="sm" className="w-full" disabled={loading} onClick={() => void analyze()} data-testid="analyze-part">
            {loading ? 'Analisando…' : 'Analisar balanços, paredes e orientação'}
          </Button>
        ) : (
          <>
            <p className="text-[11px] text-muted">Como está agora:</p>
            <ReportView r={report} />
            {orient && orient.down[2] === -1 && !meta.down && (
              <p className="flex items-center gap-1.5 text-[11px] text-success">
                <IconCheck size={13} /> Já está na melhor orientação para imprimir.
              </p>
            )}
            {orient && (orient.down[2] !== -1 || meta.down) && (
              <div className="space-y-1.5">
                <p className="text-[11px] leading-snug">
                  Melhor: <strong>{orient.label}</strong> — balanço {orient.report.overhangPct.toFixed(0)}% (agora {orient.current.overhangPct.toFixed(0)}%).
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  variant={meta.down ? 'subtle' : 'primary'}
                  onClick={() => dispatch(setPartMeta(part.id, { down: meta.down ? undefined : orient.down }, meta.down ? 'Remover orientação' : 'Orientar para impressão'))}
                >
                  {meta.down ? (
                    <>Exportar como está</>
                  ) : (
                    <>
                      <IconCheck size={14} /> Usar esta orientação na exportação
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </Section>

      {doc.technology === 'RESINA' && (
        <Section title="Oco (resina)">
          {hollowOp ? (
            <p className="text-[11px] text-muted">Esta parte já está oca — edite pelo histórico.</p>
          ) : (
            <>
              <p className="text-[11px] leading-snug text-muted">Economiza resina e reduz a força de descolamento. Os drenos ficam nos pontos mais baixos da cavidade.</p>
              <Field label="Parede">{(id) => <NumberInput id={id} value={hollow.wall} min={0.8} max={10} step={0.1} digits={1} onChange={(wall) => setHollow({ ...hollow, wall })} />}</Field>
              <Field label="Ø dreno">{(id) => <NumberInput id={id} value={hollow.drainDiameter} min={1} max={10} step={0.5} digits={1} onChange={(drainDiameter) => setHollow({ ...hollow, drainDiameter })} />}</Field>
              <Field label="Drenos">{(id) => <NumberInput id={id} value={hollow.drainCount} min={0} max={6} step={1} digits={0} unit="" onChange={(drainCount) => setHollow({ ...hollow, drainCount: Math.round(drainCount) })} />}</Field>
              {hollow.drainCount === 0 && (
                <p className="flex gap-1.5 text-[11px] text-warning">
                  <IconAlert size={13} /> Sem drenos a cavidade faz efeito ventosa e retém resina.
                </p>
              )}
              <Button size="sm" className="w-full" onClick={applyHollow} data-testid="apply-hollow">
                Tornar oca
              </Button>
            </>
          )}
        </Section>
      )}
    </>
  );
}

/** Edits an existing hollow operation. */
export function HollowInspector({ opId }: { opId: string }) {
  const op = useHistory((s) => s.doc.operations.find((o) => o.id === opId)) as Extract<Operation, { kind: 'hollow' }> | undefined;
  const report = useUI((s) => s.reports[opId]);
  if (!op) return null;
  const set = (patch: Partial<typeof op>) => dispatch(updateOperation({ ...op, ...patch }, 'Editar oco', `hollow-${op.id}`));
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Oco (resina)">
          {report?.error && <p className="rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{report.error}</p>}
          {report?.info && <p className="text-[11px] text-success">{report.info}</p>}
          {report?.warnings.map((w) => (
            <p key={w} className="rounded-md bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              {w}
            </p>
          ))}
          <Field label="Parede">{(id) => <NumberInput id={id} value={op.wall} min={0.8} max={10} step={0.1} digits={1} onChange={(wall) => set({ wall })} />}</Field>
          <Field label="Ø dreno">{(id) => <NumberInput id={id} value={op.drainDiameter} min={1} max={10} step={0.5} digits={1} onChange={(drainDiameter) => set({ drainDiameter })} />}</Field>
          <Field label="Drenos">{(id) => <NumberInput id={id} value={op.drainCount} min={0} max={6} step={1} digits={0} unit="" onChange={(drainCount) => set({ drainCount: Math.round(drainCount) })} />}</Field>
        </Section>
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button
          variant="danger"
          onClick={() => {
            dispatch(removeOperation(op.id, 'Remover oco'));
            setUI({ connectorEdit: null });
          }}
        >
          Remover
        </Button>
        <Button variant="subtle" className="flex-1" onClick={() => setUI({ connectorEdit: null })}>
          Concluir
        </Button>
      </div>
    </div>
  );
}

