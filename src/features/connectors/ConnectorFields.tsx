import { TOLERANCE_PRESETS } from '../../geometry/connectors';
import type { ConnectorParams, ConnectorType } from '../../geometry/types';
import { useHistory } from '../../store/history';
import { Field, NumberInput, Segmented, Select } from '../../ui/components';

export interface ConnectorValue {
  type: ConnectorType;
  params: ConnectorParams;
}

const COUNT_OPTIONS = [
  { value: 'auto', label: 'Automático' },
  { value: '1', label: '1 por face' },
  { value: '2', label: '2 por face' },
  { value: '3', label: '3 por face' },
  { value: '4', label: '4 por face' },
];

export function ConnectorFields({ value, onChange }: { value: ConnectorValue; onChange: (v: ConnectorValue) => void }) {
  const tech = useHistory((s) => s.doc.technology);
  const p = value.params;
  const set = (patch: Partial<ConnectorParams>) => onChange({ ...value, params: { ...p, ...patch } });
  const preset = TOLERANCE_PRESETS[tech];

  return (
    <div className="space-y-2.5">
      <Segmented
        label="Tipo de conector"
        value={value.type}
        onChange={(type) => onChange({ ...value, type })}
        options={[
          { value: 'pin', label: 'Pino macho/fêmea' },
          { value: 'dowel', label: 'Pino solto' },
        ]}
      />
      <p className="text-[11px] leading-snug text-muted">
        {value.type === 'pin'
          ? 'O pino nasce numa parte e encaixa num furo com folga na outra.'
          : 'Furos nas duas partes e um pino impresso à parte — ideal para peças finas.'}
      </p>
      <Field label="Diâmetro">{(id) => <NumberInput id={id} value={p.diameter} min={1} max={40} step={0.5} onChange={(diameter) => set({ diameter })} />}</Field>
      <Field label="Profundidade">{(id) => <NumberInput id={id} value={p.depth} min={1} max={60} step={0.5} onChange={(depth) => set({ depth })} />}</Field>
      <Field label="Folga" hint={`Preset ${preset.label}: ${preset.range[0]}–${preset.range[1]} mm`}>
        {(id) => (
          <div className="flex items-center gap-1.5">
            <NumberInput id={id} value={p.clearance} min={0} max={1.5} step={0.01} onChange={(clearance) => set({ clearance })} />
            <button
              className="h-7 shrink-0 rounded-md border border-line px-1.5 text-[10px] text-muted hover:text-text"
              title={`Usar folga padrão ${preset.label} (${preset.clearance} mm)`}
              onClick={() => set({ clearance: preset.clearance })}
            >
              {preset.label}
            </button>
          </div>
        )}
      </Field>
      <Field label="Chanfro">{(id) => <NumberInput id={id} value={p.chamfer} min={0} max={3} step={0.1} onChange={(chamfer) => set({ chamfer })} />}</Field>
      <Field label="Parede mín." hint="Espessura mínima de material ao redor do furo">
        {(id) => <NumberInput id={id} value={p.minWall} min={0.4} max={10} step={0.1} onChange={(minWall) => set({ minWall })} />}
      </Field>
      <Field label="Quantidade">
        {(id) => <Select id={id} value={String(p.count)} options={COUNT_OPTIONS} onChange={(v) => set({ count: v === 'auto' ? 'auto' : Number(v) })} />}
      </Field>
      {value.type === 'pin' && (
        <Field label="Pino na parte">
          {() => (
            <Segmented
              label="Parte que recebe o pino"
              value={p.maleSide}
              onChange={(maleSide) => set({ maleSide })}
              options={[
                { value: 'a', label: 'A (azul)' },
                { value: 'b', label: 'B (laranja)' },
              ]}
            />
          )}
        </Field>
      )}
    </div>
  );
}
