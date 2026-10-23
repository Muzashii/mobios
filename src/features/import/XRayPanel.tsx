import type { IssueSeverity, MeshIssue } from '../../geometry/types';
import { focusBox, setUI, useUI } from '../../store/ui';
import { Button, cx, Field, Kbd, mm, NumberInput, Section, Select } from '../../ui/components';
import { IconAlert, IconCheck, IconFocus, IconInfo, IconX } from '../../ui/icons';
import { XRAY_COLORS } from '../../ui/tokens';
import { applyXRay, resetXRayChoices, setXRayChoice, skipXRay } from './importActions';

const GRADE = {
  ok: { label: 'Pronta', className: 'bg-success/15 text-success' },
  repair: { label: 'Precisa de reparo', className: 'bg-warning/15 text-warning' },
  critical: { label: 'Crítica', className: 'bg-danger/15 text-danger' },
} as const;

const SEVERITY: Record<IssueSeverity, string> = { critical: 'text-danger', warning: 'text-warning', info: 'text-muted' };

function IssueRow({ issue, index, choice, focused }: { issue: MeshIssue; index: number; choice?: string; focused: boolean }) {
  const color = XRAY_COLORS[issue.kind];
  const show = () => {
    const x = useUI.getState().xray;
    if (!x) return;
    setUI({ xray: { ...x, focusIssue: focused ? null : index } });
    if (issue.focus && !focused) focusBox(issue.focus);
  };
  return (
    <li className={cx('space-y-1.5 rounded-lg border px-2.5 py-2', focused ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2')}>
      <div className="flex items-start gap-2">
        <span className={cx('mt-0.5 shrink-0', SEVERITY[issue.severity])}>{issue.severity === 'info' ? <IconInfo size={14} /> : <IconAlert size={14} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {color && issue.markers && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
            {issue.title}
          </div>
          <p className="text-[11px] leading-snug text-muted">{issue.detail}</p>
        </div>
        {issue.markers && (
          <Button size="sm" variant="ghost" onClick={show} aria-pressed={focused} title="Mostrar no viewport">
            <IconFocus size={13} /> {focused ? 'Todos' : 'Mostrar'}
          </Button>
        )}
      </div>
      {issue.options.length > 1 && (
        <Select<string> value={choice ?? issue.options[0].value} options={issue.options.map((o, i) => ({ value: o.value, label: i === 0 ? `${o.label} (recomendado)` : o.label }))} onChange={(v) => setXRayChoice({ [issue.kind]: v })} />
      )}
      {issue.options.length === 1 && <p className="text-[11px] text-accent">→ {issue.options[0].label}</p>}
      {issue.options.find((o) => o.value === (choice ?? issue.options[0]?.value))?.hint && (
        <p className="text-[11px] text-muted">{issue.options.find((o) => o.value === (choice ?? issue.options[0].value))!.hint}</p>
      )}
    </li>
  );
}

/** Raio-X da malha: everything found on import, with the repair the user wants for each. */
export function XRayPanel() {
  const x = useUI((s) => s.xray);
  const busy = useUI((s) => s.busy);
  // The inspector keeps rendering this panel during its exit animation, after the import ends.
  if (!x) return null;
  const r = x.reports[x.index];
  const plan = x.plans[x.index];
  const grade = GRADE[r.grade];
  const volumetric = Object.values(plan).includes('volumetric');
  const changed = r.issues.some((i) => i.options.length > 1 && plan[i.kind] !== undefined && plan[i.kind] !== i.options[0].value);
  const actionable = r.issues.filter((i) => i.options.length > 0 && i.options[0].value !== 'warn' && i.options[0].value !== 'none').length;
  return (
    <div className="flex h-full flex-col" data-testid="xray">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Raio-X da malha" aside={x.reports.length > 1 ? <span className="text-[11px] text-muted">{x.index + 1} de {x.reports.length}</span> : undefined}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{r.name}</span>
            <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', grade.className)}>{grade.label}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-muted">Triângulos</dt>
            <dd className="num text-right">{r.triangles.toLocaleString('pt-BR')}</dd>
            <dt className="text-muted">Cascas</dt>
            <dd className="num text-right">{r.shells}</dd>
            <dt className="text-muted">Tamanho</dt>
            <dd className="num text-right">
              {r.size.map((v) => mm(v, 0)).join(' × ')} mm
            </dd>
            <dt className="text-muted">Volume</dt>
            <dd className="num text-right">{r.volume !== null ? `${mm(r.volume / 1000, 1)} cm³` : 'aberta'}</dd>
            <dt className="text-muted">Análise</dt>
            <dd className="num text-right">{mm(r.ms / 1000, 1)} s</dd>
          </dl>
          {r.issues.length === 0 && <p className="text-[11px] text-success">Nenhum problema encontrado.</p>}
        </Section>
        {r.issues.length > 0 && (
          <Section title={`${r.issues.length} item(ns)`} aside={changed ? <Button size="sm" variant="ghost" onClick={resetXRayChoices}>Restaurar recomendado</Button> : undefined}>
            <ul className="space-y-1.5">
              {r.issues.map((issue, i) => (
                <IssueRow key={issue.kind} issue={issue} index={i} choice={plan[issue.kind]} focused={x.focusIssue === i} />
              ))}
            </ul>
            {volumetric && (
              <Field label="Resolução" hint="Voxels no maior lado. Mais = mais detalhe e mais tempo.">
                {(id) => (
                  <NumberInput
                    id={id}
                    value={plan.volumetricResolution ?? 160}
                    min={48}
                    max={400}
                    step={16}
                    digits={0}
                    onChange={(v) => setXRayChoice({ volumetricResolution: v })}
                  />
                )}
              </Field>
            )}
            {volumetric && <p className="text-[11px] text-muted">Detalhe mínimo ≈ {mm(Math.max(...r.size) / (plan.volumetricResolution ?? 160), 2)} mm.</p>}
          </Section>
        )}
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => void skipXRay()}>
          <IconX size={15} /> Não importar
        </Button>
        <Button variant="primary" className="flex-1" disabled={busy} onClick={() => void applyXRay()} data-testid="xray-apply">
          <IconCheck size={15} /> {actionable ? (changed ? 'Reparar e importar' : 'Reparar tudo (recomendado)') : 'Importar'} <Kbd>Enter</Kbd>
        </Button>
      </div>
    </div>
  );
}
