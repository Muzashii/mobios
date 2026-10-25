import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useMemo, type ReactNode } from 'react';
import { mergeMapParts, renameMapPart, unmergeMapPart } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { requestPartMap } from '../../store/partmaps';
import type { PartMapEdits } from '../../store/project';
import { setUI, splitTarget, useUI } from '../../store/ui';
import { Button, Kbd, Section, Select } from '../../ui/components';
import { IconBed, IconBrush, IconCut, IconPen, IconX } from '../../ui/icons';
import { autoSplitPart } from '../analysis/PrintPrep';
import { splitIntoParts, startBrush, startCut, startDraw } from '../cut/cutActions';
import { mapGroups } from '../parts/groups';
import { goToStep } from '../../app/commands';
import { StepEmpty, StepHeader } from './StepHeader';

const NO_EDITS: PartMapEdits = { names: {}, merged: {} };

/**
 * Step 2: split the model into printable pieces. The piece shows its detected parts in colour;
 * one button separates them all, a click on the model separates just one, and every other kind
 * of cut sits in a single "Cortar" menu.
 */
export function SplitStep() {
  const target = useUI(splitTarget);
  const part = useUI((s) => s.parts.find((p) => p.id === target));
  const cache = useUI((s) => (target ? s.partMaps[target] : undefined));
  const edits = useHistory((s) => (target ? s.doc.partMaps?.[target] : undefined)) ?? NO_EDITS;
  const hover = useUI((s) => (s.mapHover?.part === target ? s.mapHover.group : null));
  const count = useUI((s) => s.parts.length);
  const result = cache?.status === 'ready' ? cache.result : undefined;
  const groups = useMemo(() => (result ? mapGroups(result, edits) : []), [result, edits]);

  useEffect(() => {
    if (target) requestPartMap(target);
  }, [target]);

  const header = <StepHeader n={2} title="Separar" text="Divida o modelo em peças para imprimir. Cada junta ganha pino e número." />;
  if (!part)
    return (
      <div className="h-full overflow-y-auto">
        {header}
        <StepEmpty>
          {count === 0 ? 'Abra um modelo primeiro.' : `${count} peças. Para dividir mais alguma, clique nela no modelo ou na lista.`}
          {count > 1 && (
            <div className="mt-4">
              <Button variant="primary" onClick={() => goToStep('fit')}>
                Próximo: encaixes →
              </Button>
            </div>
          )}
        </StepEmpty>
      </div>
    );

  const name = useHistory.getState().doc.partMeta[part.id]?.name ?? part.name;
  const nameOf = (id: number) => groups.find((g) => g.id === id)?.name ?? '';
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {header}
        <Section title={result ? `Partes encontradas · ${groups.length}` : 'Partes encontradas'} aside={<span className="max-w-32 truncate text-[11px] text-muted">{name}</span>}>
          {!result ? (
            <p className="shimmer rounded-lg bg-surface-2 px-3 py-3 text-xs text-muted" role="status">
              {cache?.status === 'error' ? `Não deu para reconhecer: ${cache.error}` : 'Reconhecendo cabeça, braços, pernas…'}
            </p>
          ) : (
            <>
              <ul className="space-y-0.5" aria-label="Partes detectadas">
                {groups.map((g) => (
                  <li
                    key={g.id}
                    className={`rounded-lg px-1.5 py-1 transition-colors ${hover === g.id ? 'bg-surface-3' : ''}`}
                    onMouseEnter={() => setUI({ mapHover: { part: part.id, group: g.id } })}
                    onMouseLeave={() => setUI({ mapHover: null })}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="size-3 shrink-0 rounded-sm" style={{ background: g.color }} aria-hidden />
                      <input
                        value={g.name}
                        aria-label="Nome da parte"
                        onChange={(e) => dispatch(renameMapPart(part.id, g.id, e.target.value))}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-line focus:border-accent"
                      />
                      <span className="num w-9 shrink-0 text-right text-[11px] text-muted">{Math.round(g.share * 100)}%</span>
                      <div className="w-[5.5rem] shrink-0">
                        <Select
                          value=""
                          aria-label={`Juntar ${g.name} com outra parte`}
                          options={[{ value: '', label: 'Juntar…' }, ...groups.filter((o) => o.id !== g.id).map((o) => ({ value: String(o.id), label: o.name }))]}
                          onChange={(v) => v && dispatch(mergeMapParts(part.id, g.id, +v, `Juntar ${g.name} com ${nameOf(+v)}`))}
                        />
                      </div>
                    </div>
                    {g.members.length > 1 && (
                      <div className="mt-1 flex flex-wrap gap-1 pl-[18px]">
                        {g.members.slice(1).map((m) => (
                          <button
                            key={m}
                            className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted hover:text-text"
                            title="Separar de novo"
                            onClick={() => dispatch(unmergeMapPart(part.id, m, `Separar ${result.parts.find((p) => p.id === m)?.name ?? 'parte'}`))}
                          >
                            {edits.names[m] ?? result.parts.find((p) => p.id === m)?.name}
                            <IconX size={10} />
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Button variant="primary" className="h-10 w-full text-sm" disabled={groups.length < 2} onClick={() => void splitIntoParts(part.id)} data-testid="split-all">
                Separar em {groups.length} peças
              </Button>
              <p className="text-[11px] leading-snug text-muted">
                Ou clique numa parte no modelo para separar só ela. Algo deve sair junto (olhos com o rosto)? Use “Juntar…”.
              </p>
            </>
          )}
        </Section>
        <Section title="Outro tipo de corte">
          <CutMenu partId={part.id} />
        </Section>
      </div>
    </div>
  );
}

function CutOption({ icon, title, text, shortcut, onSelect }: { icon: ReactNode; title: string; text: string; shortcut?: string; onSelect: () => void }) {
  return (
    <Menu.Item onSelect={onSelect} className="flex cursor-default items-start gap-3 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-surface-3">
      <span className="mt-0.5 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11px] leading-snug text-muted">{text}</span>
      </span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Menu.Item>
  );
}

/** Every way to cut, in one menu. */
export function CutMenu({ partId }: { partId: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button className="w-full justify-between" data-testid="cut-menu">
          <span className="flex items-center gap-2">
            <IconCut size={15} /> Cortar…
          </span>
          <span className="text-muted">▾</span>
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="z-50 w-80 rounded-xl border border-line bg-surface-2 p-1 shadow-panel" sideOffset={6} align="start">
          <CutOption icon={<IconCut size={16} />} title="Plano" text="Corte reto com gizmo; pode ter degrau ou zigue-zague." shortcut="C" onSelect={() => startCut(partId)} />
          <CutOption icon={<IconPen size={16} />} title="Traço livre" text="Desenhe na tela a linha por onde cortar." shortcut="L" onSelect={() => startDraw(partId)} />
          <CutOption
            icon={<IconBrush size={16} />}
            title="Pincel"
            text="Pinte à mão a região que deve sair (para partes que não foram reconhecidas)."
            shortcut="B"
            onSelect={() => {
              startBrush(partId);
              setUI({ brushAdvanced: true });
            }}
          />
          <CutOption icon={<IconBed size={16} />} title="Caber na impressora" text="Divide sozinho em pedaços que cabem na mesa." onSelect={() => void autoSplitPart(partId)} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
