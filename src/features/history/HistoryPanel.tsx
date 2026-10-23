import type { Operation } from '../../geometry/types';
import { removeOperation } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { useUI } from '../../store/ui';
import { cx } from '../../ui/components';
import { CONNECTOR_TYPES } from '../../geometry/connectors';
import { IconAlert, IconCube, IconCut, IconHash, IconPin, IconTrash } from '../../ui/icons';
import { editConnector, editCut } from '../cut/cutActions';

const PROFILE_NAMES = { step: ' em degrau', zigzag: ' em zigue-zague', wave: ' ondulado' } as const;

function describe(op: Operation, index: number, names: Map<string, string>, labels: Map<string, string>) {
  if (op.kind === 'cut-plane') {
    const t = names.get(op.target) ?? 'parte';
    const profile = op.profile && op.profile.amplitude > 0 ? PROFILE_NAMES[op.profile.kind] : '';
    return { icon: <IconCut size={14} />, title: `Corte ${index}${op.bounded ? ' limitado' : ''}${profile}`, sub: t };
  }
  if (op.kind === 'cut-surface') {
    return { icon: <IconCut size={14} />, title: `Corte ${index} livre`, sub: names.get(op.target) ?? 'parte' };
  }
  if (op.kind === 'hollow') {
    return { icon: <IconCube size={14} />, title: 'Oco (resina)', sub: `${names.get(op.target) ?? 'parte'} · parede ${op.wall} mm` };
  }
  if (op.kind === 'label') {
    return { icon: <IconHash size={14} />, title: `Numeração ${labels.get(op.joint) ?? ''}`, sub: `texto ${op.size} mm · ${op.depth} mm de fundo` };
  }
  const type = CONNECTOR_TYPES.find((t) => t.value === op.type)?.label ?? op.type;
  return {
    icon: <IconPin size={14} />,
    title: `Encaixe ${labels.get(op.joint) ?? ''}`,
    sub: `${type} ${op.params.diameter} mm · folga ${op.params.clearance} mm`,
  };
}

/** Editable timeline: click an operation to edit it — everything after recomputes. */
export function HistoryPanel() {
  const doc = useHistory((s) => s.doc);
  const canUndo = useHistory((s) => s.past.length > 0);
  const reports = useUI((s) => s.reports);
  const joints = useUI((s) => s.joints);
  const draft = useUI((s) => s.draft);
  const connectorEdit = useUI((s) => s.connectorEdit);
  const names = new Map<string, string>(doc.sources.map((s) => [s.id, s.name]));
  for (const p of useUI.getState().parts) names.set(p.id, doc.partMeta[p.id]?.name ?? p.name);
  const labels = new Map(joints.map((j) => [j.id, j.label]));
  let cutIndex = 0;

  return (
    <section aria-label="Histórico" className="flex min-w-0 flex-[1.3] flex-col border-l border-line">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Histórico</h2>
        <span className="text-[11px] text-muted">{canUndo ? 'Ctrl+Z desfaz' : 'clique numa etapa para editar'}</span>
      </header>
      <ol className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto overflow-y-hidden p-2">
        {doc.sources.map((s) => (
          <li key={s.id} className="flex w-40 shrink-0 flex-col justify-center rounded-lg border border-line bg-surface-2 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <IconCube size={14} /> Importar
            </div>
            <div className="truncate text-xs">{s.name}</div>
          </li>
        ))}
        {doc.operations.map((op) => {
          const isCut = op.kind === 'cut-plane' || op.kind === 'cut-surface';
          if (isCut) cutIndex++;
          const d = describe(op, cutIndex, names, labels);
          const rep = reports[op.id];
          const active = draft?.editingOpId === op.id || connectorEdit === op.id;
          return (
            <li key={op.id} className="shrink-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => (isCut ? void editCut(op.id) : editConnector(op.id))}
                onKeyDown={(e) => e.key === 'Enter' && (isCut ? void editCut(op.id) : editConnector(op.id))}
                className={cx(
                  'group relative flex h-full w-48 cursor-pointer flex-col justify-center rounded-lg border px-3 py-2 text-left transition-colors',
                  active ? 'border-accent bg-accent-soft' : rep?.error ? 'border-danger/60 bg-danger/5' : 'border-line bg-surface-2 hover:border-muted',
                )}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={rep?.error ? 'text-danger' : 'text-accent'}>{rep?.error ? <IconAlert size={14} /> : d.icon}</span>
                  <span className="font-medium">{d.title}</span>
                </div>
                <div className="truncate text-[11px] text-muted">{rep?.error ?? d.sub}</div>
                {rep?.info && !rep.error && <div className="num truncate text-[10px] text-muted">{rep.info}</div>}
                {rep?.warnings.length ? <div className="truncate text-[10px] text-warning" title={rep.warnings.join('\n')}>⚠ {rep.warnings[0]}</div> : null}
                <button
                  aria-label="Remover etapa"
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted opacity-0 hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(removeOperation(op.id, `Remover ${d.title.toLowerCase()}`));
                  }}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </li>
          );
        })}
        {doc.sources.length === 0 && <li className="px-1 py-2 text-xs text-muted">As operações aparecem aqui como uma linha do tempo editável.</li>}
      </ol>
    </section>
  );
}
