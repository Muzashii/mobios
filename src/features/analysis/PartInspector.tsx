import { materialGrams } from '../../geometry/analysis';
import { removeSource, setPartMeta } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { printerOf } from '../../store/project';
import { focus, useUI, type ViewPart } from '../../store/ui';
import { Button, Field, Kbd, Section, mm } from '../../ui/components';
import { IconAlert, IconCheck, IconCut, IconEye, IconEyeOff, IconFocus, IconTrash } from '../../ui/icons';
import { startBrush, startCut } from '../cut/cutActions';
import { SlotPicker } from '../paint/SlotPicker';
import { PrintPrep } from './PrintPrep';

export function fitsPrinter(size: number[], volume: number[]) {
  const direct = size.every((s, i) => s <= volume[i]);
  const sorted = [...size].sort((a, b) => a - b);
  const vol = [...volume].sort((a, b) => a - b);
  return { direct, rotated: sorted.every((s, i) => s <= vol[i]) };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  );
}

export function PartInspector({ part }: { part: ViewPart }) {
  const doc = useHistory((s) => s.doc);
  const allJoints = useUI((s) => s.joints);
  const joints = allJoints.filter((j) => j.a === part.id || j.b === part.id);
  const meta = doc.partMeta[part.id] ?? {};
  const name = meta.name ?? part.name;
  const s = part.stats;
  const size = [0, 1, 2].map((i) => s.bounds.max[i] - s.bounds.min[i]);
  const printer = printerOf(doc);
  const fit = fitsPrinter(size, printer.volume);
  const isSource = doc.sources.some((x) => x.id === part.id);
  const biggest = joints.reduce<(typeof joints)[number] | null>((best, j) => (!best || j.faceArea > best.faceArea ? j : best), null);

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Parte">
        <Field label="Nome">
          {(id) => (
            <input
              id={id}
              value={name}
              onChange={(e) => dispatch(setPartMeta(part.id, { name: e.target.value }, 'Renomear parte', `rename-${part.id}`))}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-7 w-full rounded-md border border-line bg-surface-2 px-2 text-xs outline-none focus:border-accent"
            />
          )}
        </Field>
        <Field label="Filamento">{() => <SlotPicker partId={part.id} />}</Field>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="primary" onClick={() => startCut(part.id)}>
            <IconCut size={14} /> Cortar <Kbd>C</Kbd>
          </Button>
          <Button size="sm" onClick={() => startBrush(part.id)}>
            SmartCut <Kbd>S</Kbd>
          </Button>
          <Button size="sm" onClick={() => focus(part.id)}>
            <IconFocus size={14} /> Focar
          </Button>
          <Button size="sm" onClick={() => dispatch(setPartMeta(part.id, { visible: meta.visible === false }, meta.visible === false ? 'Mostrar parte' : 'Ocultar parte'))}>
            {meta.visible === false ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </Button>
          {isSource && (
            <Button size="sm" variant="danger" onClick={() => dispatch(removeSource(part.id, name))} title="Remover malha do projeto">
              <IconTrash size={14} />
            </Button>
          )}
        </div>
      </Section>

      <Section title="Medidas">
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Dimensões (mm)" value={size.map((v) => mm(v, 1)).join(' × ')} />
          <Stat label="Volume" value={`${mm(s.volume / 1000, 1)} cm³`} />
          <Stat label={`Material (${doc.technology === 'FDM' ? 'PLA' : 'resina'} sólido)`} value={`${mm(materialGrams(s.volume, doc.technology), 1)} g`} />
          <Stat label="Triângulos" value={s.triangles.toLocaleString('pt-BR')} />
        </div>
        <div className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px] ${fit.direct ? 'bg-success/10 text-success' : fit.rotated ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'}`}>
          {fit.direct ? <IconCheck size={14} /> : <IconAlert size={14} />}
          <span>
            {fit.direct
              ? `Cabe na ${printer.name}.`
              : fit.rotated
                ? `Cabe na ${printer.name} se girada.`
                : `Não cabe na ${printer.name} (${printer.volume.join(' × ')} mm). Corte em mais partes.`}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-muted">
          <IconCheck size={14} className="text-success" />
          Malha fechada (manifold){s.components > 1 ? ` · ${s.components} corpos` : ''}
          {s.genus > 0 ? ` · ${s.genus} furo(s) passante(s)` : ''}
        </div>
        {joints.length > 0 && (
          <div className="space-y-1 text-[11px] text-muted">
            {joints.map((j) => (
              <div key={j.id} className="flex justify-between">
                <span>Face de colagem {j.label}</span>
                <span className="num text-text">{mm(j.faceArea / 100, 1)} cm²</span>
              </div>
            ))}
            {biggest && (
              <p className="pt-1 leading-snug">
                Sugestão: imprima com a face <strong className="text-text">{biggest.label}</strong> virada para a mesa — superfície plana, menos suporte.
              </p>
            )}
          </div>
        )}
      </Section>
      <PrintPrep part={part} fits={fit.rotated || part.id.endsWith('.pins')} />
    </div>
  );
}
