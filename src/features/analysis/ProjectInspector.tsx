import { TOLERANCE_PRESETS } from '../../geometry/connectors';
import type { Technology } from '../../geometry/types';
import { setClearance, setFilament, setPrinter, setTechnology } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { PRINTERS, printerOf } from '../../store/project';
import { setUI, useUI } from '../../store/ui';
import { Button, Field, NumberInput, Section, Segmented, Select, Switch } from '../../ui/components';
import { IconRuler } from '../../ui/icons';
import { addCalibration } from '../import/importActions';

export function ProjectInspector() {
  const doc = useHistory((s) => s.doc);
  const showBed = useUI((s) => s.showBed);
  const parts = useUI((s) => s.parts);
  const printer = printerOf(doc);
  const tech = doc.technology;
  const totalVolume = parts.reduce((s, p) => s + p.stats.volume, 0);

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Impressão">
        <Field label="Impressora">
          {(id) => (
            <Select
              id={id}
              value={doc.printerId}
              options={PRINTERS.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => dispatch(setPrinter(v, PRINTERS.find((p) => p.id === v)!.technology))}
            />
          )}
        </Field>
        <Field label="Tecnologia">
          {() => (
            <Segmented<Technology>
              label="Tecnologia"
              value={tech}
              onChange={(v) => dispatch(setTechnology(v))}
              options={[
                { value: 'FDM', label: 'FDM' },
                { value: 'RESINA', label: 'Resina' },
              ]}
            />
          )}
        </Field>
        <Field label="Volume" hint="Volume de impressão da impressora">
          {() => (
            <div className="flex items-center justify-between">
              <span className="num text-xs">{printer.volume.map((v) => Math.round(v)).join(' × ')} mm</span>
              <Switch label="Mostrar volume da impressora" checked={showBed} onChange={(v) => setUI({ showBed: v })} />
            </div>
          )}
        </Field>
      </Section>

      <Section title="Folga dos encaixes">
        <Field label={`Padrão ${TOLERANCE_PRESETS[tech].label}`} hint={`Faixa recomendada: ${TOLERANCE_PRESETS[tech].range.join('–')} mm`}>
          {(id) => <NumberInput id={id} value={doc.clearance[tech]} min={0} max={1} step={0.01} onChange={(v) => dispatch(setClearance(tech, v))} />}
        </Field>
        <p className="text-[11px] leading-snug text-muted">
          Faixa recomendada {TOLERANCE_PRESETS[tech].range.join('–')} mm. Não tem certeza? Imprima a peça de calibração e escolha a folga que encaixa firme.
        </p>
        <Button size="sm" className="w-full" onClick={() => void addCalibration()}>
          <IconRuler size={14} /> Gerar peça de calibração
        </Button>
      </Section>

      <Section title="Filamentos (AMS)">
        <div className="grid grid-cols-4 gap-2">
          {doc.filaments.map((c, i) => (
            <label key={i} className="flex flex-col items-center gap-1 text-[10px] text-muted">
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
        <p className="text-[11px] leading-snug text-muted">Use a ferramenta de pintura (B) e clique nas partes. O 3MF abre no Bambu Studio com cada parte no seu slot.</p>
      </Section>

      {parts.length > 0 && (
        <Section title="Resumo">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Partes</span>
            <span className="num">{parts.length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Volume total</span>
            <span className="num">{(totalVolume / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm³</span>
          </div>
        </Section>
      )}
    </div>
  );
}
