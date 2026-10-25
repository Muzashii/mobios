import { setFilament } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { setUI, useUI } from '../../store/ui';
import { Section, Switch } from '../../ui/components';
import { partColor } from '../paint/colors';
import { SlotPicker } from '../paint/SlotPicker';
import { StepEmpty, StepHeader } from './StepHeader';

/** Step 4: filament per piece — the 3MF opens in Bambu Studio with each piece on its slot. */
export function ColorStep() {
  const doc = useHistory((s) => s.doc);
  const parts = useUI((s) => s.parts);
  const painting = useUI((s) => s.tool === 'paint');

  return (
    <div className="h-full overflow-y-auto">
      <StepHeader n={4} title="Cores" text="Escolha o filamento de cada peça. O 3MF abre no Bambu Studio com cada peça no seu slot." />
      <Section title="Filamentos (AMS)">
        <div className="grid grid-cols-4 gap-2">
          {doc.filaments.map((c, i) => (
            <label key={i} className="flex flex-col items-center gap-1 text-[11px] text-muted">
              <input
                type="color"
                value={c}
                aria-label={`Cor do slot ${i + 1}`}
                onChange={(e) => dispatch(setFilament(i + 1, e.target.value))}
                className="h-9 w-full cursor-pointer rounded-md border border-line bg-transparent"
              />
              Slot {i + 1}
            </label>
          ))}
        </div>
        <label className="flex items-center justify-between gap-2 text-xs">
          Pintar clicando no modelo
          <Switch label="Pintar clicando no modelo" checked={painting} onChange={(v) => setUI({ tool: v ? 'paint' : 'select', draft: null })} />
        </label>
      </Section>
      <Section title={`Peças · ${parts.length}`}>
        {parts.length === 0 && <StepEmpty>Abra um modelo primeiro.</StepEmpty>}
        <ul className="space-y-1.5" aria-label="Cor de cada peça">
          {parts.map((p) => (
            <li key={p.id} className="flex items-center gap-2" onMouseEnter={() => setUI({ hovered: p.id })} onMouseLeave={() => setUI({ hovered: null })}>
              <span className="size-3 shrink-0 rounded-sm border border-black/20" style={{ background: partColor(doc, p) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs">{doc.partMeta[p.id]?.name ?? p.name}</span>
              <SlotPicker partId={p.id} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
