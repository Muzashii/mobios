import { useMemo } from 'react';
import { mergeMapParts, renameMapPart, showPartMap, unmergeMapPart } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { setUI, useUI, type ViewPart } from '../../store/ui';
import { Button, Section, Select } from '../../ui/components';
import { IconEyeOff, IconX } from '../../ui/icons';
import { mapGroups } from './groups';

/**
 * Automatic part map of a figure (hat, head, torso, arms…): one colour per detected part,
 * rename, join parts that belong together (eyes with the face) or take them apart again.
 */
export function PartMapPanel({ part }: { part: ViewPart }) {
  const edits = useHistory((s) => s.doc.partMaps?.[part.id]);
  const cache = useUI((s) => s.partMaps[part.id]);
  const hover = useUI((s) => (s.mapHover?.part === part.id ? s.mapHover.group : null));
  const result = cache?.status === 'ready' ? cache.result : undefined;
  const groups = useMemo(() => (result && edits ? mapGroups(result, edits) : []), [result, edits]);

  if (!edits) {
    return (
      <Section title="Partes do modelo">
        <p className="text-[11px] leading-snug text-muted">Encontra sozinho o chapéu, a cabeça, o tronco, os braços, as pernas e os acessórios, cada um com uma cor.</p>
        <Button size="sm" variant="primary" onClick={() => dispatch(showPartMap(part.id, true))}>
          Detectar partes
        </Button>
      </Section>
    );
  }

  const hide = (
    <Button size="sm" variant="ghost" onClick={() => dispatch(showPartMap(part.id, false))} title="Ocultar as partes detectadas" aria-label="Ocultar as partes detectadas">
      <IconEyeOff size={14} />
    </Button>
  );
  if (!result) {
    return (
      <Section title="Partes do modelo" aside={hide}>
        <p className="text-[11px] text-muted" role="status">
          {cache?.status === 'error' ? `Não deu para detectar: ${cache.error}` : 'Analisando a forma…'}
        </p>
      </Section>
    );
  }

  const nameOf = (id: number) => groups.find((g) => g.id === id)?.name ?? result.parts.find((p) => p.id === id)?.name ?? '';
  return (
    <Section title={`Partes do modelo · ${groups.length}`} aside={hide}>
      <ul className="space-y-1" aria-label="Partes detectadas">
        {groups.map((g) => (
          <li
            key={g.id}
            className={`rounded-md px-1.5 py-1 transition-colors ${hover === g.id ? 'bg-surface-3' : ''}`}
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
                className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs outline-none hover:border-line focus:border-accent"
              />
              <span className="num w-9 shrink-0 text-right text-[10px] text-muted">{(g.share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>
              <div className="w-24 shrink-0">
                <Select
                  value=""
                  aria-label={`Juntar ${g.name} com outra parte`}
                  options={[{ value: '', label: 'Juntar com…' }, ...groups.filter((o) => o.id !== g.id).map((o) => ({ value: String(o.id), label: o.name }))]}
                  onChange={(v) => v && dispatch(mergeMapParts(part.id, g.id, +v, `Juntar ${g.name} com ${nameOf(+v)}`))}
                />
              </div>
            </div>
            {g.members.length > 1 && (
              <div className="mt-1 flex flex-wrap gap-1 pl-[18px]">
                {g.members.slice(1).map((m) => (
                  <button
                    key={m}
                    className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted hover:text-text"
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
      <p className="text-[11px] leading-snug text-muted">Passe o mouse no modelo para ver cada parte. Junte o que deve sair junto (ex.: olhos com o rosto).</p>
    </Section>
  );
}
