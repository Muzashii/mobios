import { CONNECTOR_TYPES, defaultConnectorParams, hasMaleSide, TOLERANCE_PRESETS } from '../../geometry/connectors';
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
  const doc = useHistory((s) => s.doc);
  const tech = doc.technology;
  const p = value.params;
  const t = value.type;
  const set = (patch: Partial<ConnectorParams>) => onChange({ ...value, params: { ...p, ...patch } });
  const preset = TOLERANCE_PRESETS[tech];
  const info = CONNECTOR_TYPES.find((c) => c.value === t)!;

  const changeType = (type: ConnectorType) => {
    // Magnets and dovetails have their own sizes; peg types keep the user's numbers.
    const special = (x: ConnectorType) => x === 'magnet' || x === 'dovetail';
    const params = special(type) || special(t) ? { ...defaultConnectorParams(tech, type), clearance: special(type) ? defaultConnectorParams(tech, type).clearance : doc.clearance[tech] } : p;
    onChange({ type, params });
  };

  const sizeLabel = t === 'magnet' ? 'Ø do ímã' : t === 'dovetail' ? 'Largura' : t === 'square' || t === 'hex' ? 'Largura' : 'Diâmetro';
  const depthLabel = t === 'magnet' ? 'Altura do ímã' : t === 'dovetail' ? 'Altura' : 'Profundidade';

  return (
    <div className="space-y-2.5">
      <Field label="Tipo">{(id) => <Select id={id} value={t} options={CONNECTOR_TYPES.map((c) => ({ value: c.value, label: c.label }))} onChange={changeType} />}</Field>
      <p className="text-[11px] leading-snug text-muted">{info.hint}</p>
      <Field label={sizeLabel}>{(id) => <NumberInput id={id} value={p.diameter} min={1} max={60} step={0.5} onChange={(diameter) => set({ diameter })} />}</Field>
      <Field label={depthLabel}>{(id) => <NumberInput id={id} value={p.depth} min={0.5} max={60} step={0.5} onChange={(depth) => set({ depth })} />}</Field>
      <Field label="Folga" hint={`Preset ${preset.label}: ${preset.range[0]}–${preset.range[1]} mm`}>
        {(id) => (
          <div className="flex items-center gap-1.5">
            <NumberInput id={id} value={p.clearance} min={-0.5} max={1.5} step={0.01} onChange={(clearance) => set({ clearance })} />
            <button
              className="h-7 shrink-0 rounded-md border border-line px-1.5 text-[10px] text-muted hover:text-text"
              title={`Usar folga padrão ${preset.label}`}
              onClick={() => set({ clearance: t === 'magnet' ? defaultConnectorParams(tech, 'magnet').clearance : doc.clearance[tech] })}
            >
              {preset.label}
            </button>
          </div>
        )}
      </Field>
      {t !== 'magnet' && t !== 'dovetail' && (
        <Field label="Chanfro">{(id) => <NumberInput id={id} value={p.chamfer} min={0} max={3} step={0.1} onChange={(chamfer) => set({ chamfer })} />}</Field>
      )}
      <Field label="Parede mín." hint="Espessura mínima de material ao redor do encaixe">
        {(id) => <NumberInput id={id} value={p.minWall} min={0.4} max={10} step={0.1} onChange={(minWall) => set({ minWall })} />}
      </Field>
      {t !== 'dovetail' && (
        <Field label="Quantidade">
          {(id) => <Select id={id} value={String(p.count)} options={COUNT_OPTIONS} onChange={(v) => set({ count: v === 'auto' ? 'auto' : Number(v) })} />}
        </Field>
      )}
      {hasMaleSide(t) && (
        <Field label={t === 'dovetail' ? 'Trilho na parte' : 'Pino na parte'}>
          {() => (
            <Segmented
              label="Parte que recebe o macho"
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
