import { Vector3 } from 'three';
import type { Vec3 } from '../../geometry/types';
import { useUI, type CutDraft } from '../../store/ui';
import { Button, Field, Kbd, NumberInput, Section, Slider, Switch } from '../../ui/components';
import { IconCheck, IconX } from '../../ui/icons';
import { ConnectorFields } from '../connectors/ConnectorFields';
import { cancelCut, commitCut, draftOffsetRange, flipNormal, snapAxis, updateDraft } from './cutActions';

const AXES = ['X', 'Y', 'Z'] as const;

/** Spherical angles of the normal (degrees) for numeric editing. */
function anglesOf(n: Vec3) {
  const tilt = (Math.acos(Math.max(-1, Math.min(1, n[2]))) * 180) / Math.PI;
  const heading = (Math.atan2(n[1], n[0]) * 180) / Math.PI;
  return { tilt, heading };
}
function normalFrom(tilt: number, heading: number): Vec3 {
  const t = (tilt * Math.PI) / 180, h = (heading * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(h), Math.sin(t) * Math.sin(h), Math.cos(t)];
}

export function CutInspector({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  const range = draftOffsetRange(draft);
  const n = new Vector3(...draft.plane.normal);
  const offset = new Vector3(...draft.plane.origin).sub(range.center).dot(n);
  const { tilt, heading } = anglesOf(draft.plane.normal);

  const setOffset = (v: number) => {
    // Move along the normal, keeping the in-plane position.
    const o = new Vector3(...draft.plane.origin);
    const delta = v - offset;
    updateDraft({ plane: { ...draft.plane, origin: o.addScaledVector(n, delta).toArray() as Vec3 } });
  };
  const setOrigin = (axis: number, v: number) => {
    const origin = [...draft.plane.origin] as Vec3;
    origin[axis] = v;
    updateDraft({ plane: { ...draft.plane, origin } });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={draft.editingOpId ? 'Editar corte' : 'Corte por plano'} aside={<span className="truncate text-[11px] text-muted">{part?.name}</span>}>
          <p className="text-[11px] leading-snug text-muted">
            Arraste o gizmo no viewport ou ajuste os valores. Azul = parte A, laranja = parte B (lado da seta).
          </p>
          <Field label="Alinhar a">
            {() => (
              <div className="flex gap-1">
                {AXES.map((a, i) => (
                  <Button key={a} size="sm" variant={Math.abs(draft.plane.normal[i]) > 0.999 ? 'primary' : 'subtle'} className="flex-1" onClick={() => snapAxis(i as 0 | 1 | 2)}>
                    {a}
                  </Button>
                ))}
                <Button size="sm" variant="subtle" onClick={flipNormal} title="Inverter lado (A ↔ B)">
                  ⇅
                </Button>
              </div>
            )}
          </Field>
          <Field label="Posição">
            {(id) => (
              <div className="space-y-1.5">
                <NumberInput id={id} value={offset} step={0.5} onChange={setOffset} />
                <Slider label="Posição do plano" value={Math.max(range.min, Math.min(range.max, offset))} min={range.min} max={range.max} step={0.1} onChange={setOffset} />
              </div>
            )}
          </Field>
          <Field label="Inclinação">{(id) => <NumberInput id={id} value={tilt} unit="°" step={1} digits={1} onChange={(v) => updateDraft({ plane: { ...draft.plane, normal: normalFrom(v, heading) } })} />}</Field>
          <Field label="Direção">{(id) => <NumberInput id={id} value={heading} unit="°" step={1} digits={1} onChange={(v) => updateDraft({ plane: { ...draft.plane, normal: normalFrom(tilt, v) } })} />}</Field>
          <Field label="Origem X/Y/Z">
            {() => (
              <div className="grid grid-cols-3 gap-1">
                {[0, 1, 2].map((i) => (
                  <NumberInput key={i} value={draft.plane.origin[i]} unit="" step={0.5} digits={1} onChange={(v) => setOrigin(i, v)} />
                ))}
              </div>
            )}
          </Field>
        </Section>

        <Section title="Corte limitado" aside={<Switch label="Corte limitado" checked={draft.bounded} onChange={(bounded) => updateDraft({ bounded })} />}>
          <p className="text-[11px] leading-snug text-muted">
            Separa só a "ilha" que o plano atravessa dentro da esfera — ex.: tirar um braço sem cortar o tronco.
          </p>
          {draft.bounded && (
            <p className="text-[11px] leading-snug text-muted">O preview colore o plano inteiro; ao cortar, só as ilhas dentro da esfera viram a parte B.</p>
          )}
          {draft.bounded && (
            <Field label="Raio">
              {(id) => (
                <div className="space-y-1.5">
                  <NumberInput id={id} value={draft.radius} min={1} step={1} digits={1} onChange={(radius) => updateDraft({ radius })} />
                  <Slider label="Raio do limite" value={draft.radius} min={1} max={range.max * 1.5} step={0.5} onChange={(radius) => updateDraft({ radius })} />
                </div>
              )}
            </Field>
          )}
        </Section>

        <Section
          title="Encaixe"
          aside={
            <Switch
              label="Adicionar encaixe"
              checked={draft.connector.enabled}
              onChange={(enabled) => updateDraft({ connector: { ...draft.connector, enabled } })}
            />
          }
        >
          {draft.connector.enabled ? (
            <ConnectorFields value={draft.connector} onChange={(v) => updateDraft({ connector: { ...draft.connector, ...v } })} />
          ) : (
            <p className="text-[11px] text-muted">Sem conectores: as partes serão só separadas.</p>
          )}
        </Section>
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="ghost" className="flex-1" onClick={cancelCut}>
          <IconX size={15} /> Cancelar <Kbd>Esc</Kbd>
        </Button>
        <Button variant="primary" className="flex-1" onClick={commitCut} data-testid="commit-cut">
          <IconCheck size={15} /> Cortar <Kbd>Enter</Kbd>
        </Button>
      </div>
    </div>
  );
}
