import { setPartMeta } from '../store/commands';
import { dispatch, useHistory } from '../store/history';
import { printerOf } from '../store/project';
import { focus, setUI, useUI } from '../store/ui';
import { cx } from '../ui/components';
import { IconAlert, IconEye, IconEyeOff, IconLock, IconUnlock } from '../ui/icons';
import { fitsPrinter } from '../features/analysis/PartInspector';
import { partColor } from '../features/paint/colors';

export function Outliner() {
  const parts = useUI((s) => s.parts);
  const selection = useUI((s) => s.selection);
  const hovered = useUI((s) => s.hovered);
  const doc = useHistory((s) => s.doc);
  const printer = printerOf(doc);

  return (
    <section aria-label="Partes" className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Partes</h2>
        <span className="num text-[11px] text-muted">{parts.length}</span>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Lista de partes">
        {parts.length === 0 && <li className="px-3 py-2 text-xs text-muted">Nenhuma parte ainda.</li>}
        {parts.map((p) => {
          const meta = doc.partMeta[p.id] ?? {};
          const hidden = meta.visible === false;
          const size = [0, 1, 2].map((i) => p.stats.bounds.max[i] - p.stats.bounds.min[i]);
          const fit = fitsPrinter(size, printer.volume);
          return (
            <li
              key={p.id}
              role="option"
              aria-selected={selection === p.id}
              tabIndex={0}
              onClick={() => setUI({ selection: p.id, connectorEdit: null })}
              onDoubleClick={() => focus(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setUI({ selection: p.id });
              }}
              onMouseEnter={() => setUI({ hovered: p.id })}
              onMouseLeave={() => useUI.getState().hovered === p.id && setUI({ hovered: null })}
              className={cx(
                'group mx-1 flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-xs outline-none',
                selection === p.id ? 'bg-accent-soft text-text' : hovered === p.id ? 'bg-surface-3' : 'hover:bg-surface-3',
                hidden && 'opacity-50',
              )}
            >
              <span className="h-3 w-3 shrink-0 rounded-[3px] border border-black/20" style={{ background: partColor(doc, p) }} />
              <span className="min-w-0 flex-1 truncate">{meta.name ?? p.name}</span>
              {!fit.rotated && !p.id.endsWith('.pins') && (
                <span title={`Não cabe na ${printer.name}`} className="text-danger">
                  <IconAlert size={13} />
                </span>
              )}
              {meta.slot && <span className="num text-[10px] text-muted">S{meta.slot}</span>}
              <span className="num w-16 text-right text-[10px] text-muted">{(p.stats.volume / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm³</span>
              <button
                aria-label={meta.locked ? 'Destravar' : 'Travar'}
                className={cx('text-muted hover:text-text', !meta.locked && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(setPartMeta(p.id, { locked: !meta.locked }, meta.locked ? 'Destravar parte' : 'Travar parte'));
                }}
              >
                {meta.locked ? <IconLock size={13} /> : <IconUnlock size={13} />}
              </button>
              <button
                aria-label={hidden ? 'Mostrar' : 'Ocultar'}
                className={cx('text-muted hover:text-text', !hidden && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(setPartMeta(p.id, { visible: hidden }, hidden ? 'Mostrar parte' : 'Ocultar parte'));
                }}
              >
                {hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
