import { useUI } from '../../store/ui';
import { Button, Field, Kbd, NumberInput, Section, Slider } from '../../ui/components';
import { IconCheck, IconTrash, IconX } from '../../ui/icons';
import { cancelCut, clearBrush, suggestFromBrush } from '../cut/cutActions';
import { setUI } from '../../store/ui';

export function SmartCutInspector() {
  const brush = useUI((s) => s.brush);
  const part = useUI((s) => s.parts.find((p) => p.id === s.brush.target));
  const setRadius = (radius: number) => setUI({ brush: { ...useUI.getState().brush, radius } });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="SmartCut" aside={<span className="truncate text-[11px] text-muted">{part?.name ?? 'nenhuma parte'}</span>}>
          <p className="text-[11px] leading-snug text-muted">
            Pincele a região que quer separar (ex.: o braço inteiro) — ou só clique na ponta dela. O SmartCut procura o anel mais estreito e
            côncavo (ombro, pescoço, cintura) e propõe um corte limitado que você ainda pode ajustar.
          </p>
          <ol className="space-y-1 text-[11px] text-muted">
            <li>
              <span className="text-accent">1</span> Arraste com o botão esquerdo sobre a peça
            </li>
            <li>
              <span className="text-accent">2</span> Gire a vista com o botão direito
            </li>
            <li>
              <span className="text-accent">3</span> <Kbd>Enter</Kbd> para sugerir o corte
            </li>
          </ol>
          <Field label="Raio do pincel">
            {(id) => (
              <div className="space-y-1.5">
                <NumberInput id={id} value={brush.radius} min={0.5} max={60} step={0.5} digits={1} onChange={setRadius} />
                <Slider label="Raio do pincel" value={brush.radius} min={0.5} max={30} step={0.5} onChange={setRadius} />
              </div>
            )}
          </Field>
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              Pinceladas: <span className="num text-text">{brush.seeds.length}</span>
            </span>
            <span>
              <Kbd>[</Kbd> <Kbd>]</Kbd> ajustam o raio
            </span>
          </div>
          <Button size="sm" variant="ghost" className="w-full" disabled={!brush.seeds.length} onClick={clearBrush}>
            <IconTrash size={14} /> Limpar pincel
          </Button>
        </Section>
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button
          variant="ghost"
          className="flex-1"
          onClick={() => {
            cancelCut();
            setUI({ tool: 'select' });
          }}
        >
          <IconX size={15} /> Sair <Kbd>Esc</Kbd>
        </Button>
        <Button variant="primary" className="flex-1" disabled={!brush.seeds.length} onClick={() => void suggestFromBrush()} data-testid="smartcut-suggest">
          <IconCheck size={15} /> Sugerir <Kbd>Enter</Kbd>
        </Button>
      </div>
    </div>
  );
}
