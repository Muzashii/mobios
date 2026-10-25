import { setPartMeta } from '../store/commands';
import { dispatch, useHistory } from '../store/history';
import { printerOf } from '../store/project';
import { focus, setUI, useUI } from '../store/ui';
import { cx } from '../ui/components';
import { IconAlert, IconEye, IconEyeOff, IconLock, IconTrash, IconUnlock } from '../ui/icons';
import { deleteSelectedModel } from './commands';
import { fitsPrinter } from '../features/analysis/PartInspector';
import { partColor } from '../features/paint/colors';

export function Outliner() {
  const parts = useUI((s) => s.parts);
  const selection = useUI((s) => s.selection);
  const hovered = useUI((s) => s.hovered);
  const doc = useHistory((s) => s.doc);
  const printer = printerOf(doc);

  return (
    <section aria-label="Partes" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between px-3">
        <h2 className="text-[13px] font-semibold text-text">Partes</h2>
        <span className="num rounded-full bg-surface-3 px-1.5 text-[11px] text-muted">{parts.length}</span>
      </header>
      {parts.length === 0 && <p className="px-3 py-2 text-xs text-muted">Nenhuma parte ainda.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Lista de partes">
        {parts.map((p) => {
          const meta = doc.partMeta[p.id] ?? {};
          const hidden = meta.visible === false;
          const size = [0, 1, 2].map((i) => p.stats.bounds.max[i] - p.stats.bounds.min[i]);
          const fit = fitsPrinter(size, printer.volume);
          const name = meta.name ?? p.name;
          return (
            <li
              key={p.id}
              onMouseEnter={() => setUI({ hovered: p.id })}
              onMouseLeave={() => useUI.getState().hovered === p.id && setUI({ hovered: null })}
              className={cx(
                'group mx-1.5 flex h-8 items-center gap-1 rounded-md pr-1 text-xs',
                selection === p.id ? 'bg-accent-soft text-text' : hovered === p.id ? 'bg-surface-3' : 'hover:bg-surface-3',
                hidden && 'opacity-50',
              )}
            >
              <button
                className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 rounded-md pl-2 text-left"
                aria-pressed={selection === p.id}
                data-testid="part-row"
                onClick={() => setUI({ selection: p.id, connectorEdit: null })}
                onDoubleClick={() => focus(p.id)}
              >
                <span className="h-3 w-3 shrink-0 rounded-[3px] border border-black/20" style={{ background: partColor(doc, p) }} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {!fit.rotated && !p.id.endsWith('.pins') && (
                  <span title={`Não cabe na ${printer.name}`} className="text-danger">
                    <IconAlert size={13} />
                    <span className="sr-only">Não cabe na {printer.name}</span>
                  </span>
                )}
                {meta.slot && <span className="num text-[10px] text-muted">S{meta.slot}</span>}
                <span className="num w-16 text-right text-[10px] text-muted">{(p.stats.volume / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm³</span>
              </button>
              <button
                aria-label={`${meta.locked ? 'Destravar' : 'Travar'} ${name}`}
                className={cx('flex h-6 w-6 items-center justify-center rounded text-muted hover:text-text', !meta.locked && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                onClick={() => dispatch(setPartMeta(p.id, { locked: !meta.locked }, meta.locked ? 'Destravar parte' : 'Travar parte'))}
              >
                {meta.locked ? <IconLock size={13} /> : <IconUnlock size={13} />}
              </button>
              <button
                aria-label={`${hidden ? 'Mostrar' : 'Ocultar'} ${name}`}
                className={cx('flex h-6 w-6 items-center justify-center rounded text-muted hover:text-text', !hidden && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                onClick={() => dispatch(setPartMeta(p.id, { visible: hidden }, hidden ? 'Mostrar parte' : 'Ocultar parte'))}
              >
                {hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
              </button>
              {!p.id.endsWith('.pins') && (
                <button
                  aria-label={`Excluir o modelo de ${name}`}
                  title="Excluir o modelo importado (com os cortes dele) — Del"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  onClick={() => deleteSelectedModel(p.id)}
                >
                  <IconTrash size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
