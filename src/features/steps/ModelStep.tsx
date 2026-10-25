import { materialGrams } from '../../geometry/analysis';
import type { Technology } from '../../geometry/types';
import { deleteSelectedModel } from '../../app/commands';
import { setPartMeta, setPrinter, setTechnology, sourceOf } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { PRINTERS, printerOf } from '../../store/project';
import { focus, setUI, splitTarget, useUI, type ViewPart } from '../../store/ui';
import { Button, Field, Section, Segmented, Select, Switch, mm } from '../../ui/components';
import { IconAlert, IconCheck, IconFocus, IconOpen, IconTrash } from '../../ui/icons';
import { PrintPrep } from '../analysis/PrintPrep';
import { openExample, openFilePicker, openRepair } from '../import/importActions';
import { StepEmpty, StepHeader } from './StepHeader';

export function fitsPrinter(size: number[], volume: number[]) {
  const direct = size.every((s, i) => s <= volume[i]);
  const sorted = [...size].sort((a, b) => a - b);
  const vol = [...volume].sort((a, b) => a - b);
  return { direct, rotated: sorted.every((s, i) => s <= vol[i]) };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  );
}

/** Step 1: the model — does it fit, is the mesh sound, which printer. */
export function ModelStep() {
  const hasModel = useHistory((s) => s.doc.sources.length > 0);
  const part = useUI((s) => s.parts.find((p) => p.id === splitTarget(s)));
  const count = useUI((s) => s.parts.length);

  return (
    <div className="h-full overflow-y-auto">
      <StepHeader n={1} title="Modelo" text="Confira se o modelo cabe na impressora e se a malha está boa." />
      {!hasModel ? (
        <div className="space-y-2 p-4">
          <Button variant="primary" className="w-full" onClick={() => void openFilePicker()}>
            <IconOpen size={15} /> Abrir STL, OBJ ou 3MF
          </Button>
          <Button className="w-full" onClick={() => void openExample()}>
            Abrir exemplo
          </Button>
        </div>
      ) : part ? (
        <PartCard part={part} />
      ) : (
        <StepEmpty>
          {count} peças. Clique numa peça no modelo ou na lista para ver as medidas dela.
        </StepEmpty>
      )}
      <PrinterSection />
    </div>
  );
}

function PartCard({ part }: { part: ViewPart }) {
  const doc = useHistory((s) => s.doc);
  const meta = doc.partMeta[part.id] ?? {};
  const s = part.stats;
  const size = [0, 1, 2].map((i) => s.bounds.max[i] - s.bounds.min[i]);
  const printer = printerOf(doc);
  const fit = fitsPrinter(size, printer.volume);
  const source = sourceOf(doc, part.id);

  return (
    <>
      <Section title={meta.name ?? part.name}>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Tamanho (mm)" value={size.map((v) => mm(v, 0)).join(' × ')} />
          <Stat label="Volume" value={`${mm(s.volume / 1000, 1)} cm³`} />
          <Stat label={doc.technology === 'FDM' ? 'PLA (sólido)' : 'Resina (sólido)'} value={`${mm(materialGrams(s.volume, doc.technology), 0)} g`} />
          <Stat label="Triângulos" value={s.triangles.toLocaleString('pt-BR')} />
        </div>
        <div className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${fit.direct ? 'bg-success/10 text-success' : fit.rotated ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'}`}>
          {fit.direct ? <IconCheck size={14} /> : <IconAlert size={14} />}
          <span>
            {fit.direct ? `Cabe na ${printer.name}.` : fit.rotated ? `Cabe na ${printer.name} se girada.` : `Não cabe na ${printer.name}. Separe em mais peças.`}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-muted">
          <IconCheck size={14} className="text-success" />
          Malha fechada{s.components > 1 ? ` · ${s.components} corpos` : ''}
          {s.genus > 0 ? ` · ${s.genus} furo(s) passante(s)` : ''}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {source && (
            <Button size="sm" onClick={() => void openRepair(source)} title="Raio-X da malha: autointerseções, paredes finas, remesh, decimação…">
              Reparar malha
            </Button>
          )}
          <Button size="sm" onClick={() => focus(part.id)}>
            <IconFocus size={14} /> Focar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dispatch(setPartMeta(part.id, { visible: meta.visible === false }, meta.visible === false ? 'Mostrar parte' : 'Ocultar parte'))}>
            {meta.visible === false ? 'Mostrar' : 'Ocultar'}
          </Button>
          {!part.id.endsWith('.pins') && (
            <Button size="sm" variant="danger" className="ml-auto" onClick={() => deleteSelectedModel(part.id)} title="Excluir o modelo importado (com os cortes dele) — Del">
              <IconTrash size={14} /> Excluir
            </Button>
          )}
        </div>
      </Section>
      <PrintPrep part={part} fits={fit.rotated || part.id.endsWith('.pins')} />
    </>
  );
}

function PrinterSection() {
  const doc = useHistory((s) => s.doc);
  const showBed = useUI((s) => s.showBed);
  const printer = printerOf(doc);
  return (
    <Section title="Impressora">
      <Field label="Modelo">
        {(id) => (
          <Select id={id} value={doc.printerId} options={PRINTERS.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => dispatch(setPrinter(v, PRINTERS.find((p) => p.id === v)!.technology))} />
        )}
      </Field>
      <Field label="Tecnologia">
        {() => (
          <Segmented<Technology>
            label="Tecnologia"
            value={doc.technology}
            onChange={(v) => dispatch(setTechnology(v))}
            options={[
              { value: 'FDM', label: 'FDM' },
              { value: 'RESINA', label: 'Resina' },
            ]}
          />
        )}
      </Field>
      <Field label="Volume">
        {() => (
          <div className="flex items-center justify-between">
            <span className="num text-xs">{printer.volume.map((v) => Math.round(v)).join(' × ')} mm</span>
            <Switch label="Mostrar volume da impressora" checked={showBed} onChange={(v) => setUI({ showBed: v })} />
          </div>
        )}
      </Field>
    </Section>
  );
}
