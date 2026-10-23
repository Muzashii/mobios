import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { importFiles, openExample, openFilePicker } from '../features/import/importActions';
import { useHistory } from '../store/history';
import { setUI, useUI } from '../store/ui';
import { Button, Kbd, Slider, cx } from '../ui/components';
import { IconAlert, IconCheck, IconCube, IconCut, IconExport, IconInfo, IconOpen, IconPin, IconX } from '../ui/icons';
import { contrast } from '../features/paint/SlotPicker';
import { APP_COMMANDS } from './commands';

export function ExplodeSlider() {
  const explode = useUI((s) => s.explode);
  const count = useUI((s) => s.parts.length);
  if (count < 2) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 flex w-72 -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface/90 px-4 py-2 shadow-panel backdrop-blur">
      <span className="text-[11px] text-muted">Explodir</span>
      <Slider label="Vista explodida" value={explode} min={0} max={1} step={0.01} onChange={(v) => setUI({ explode: v })} />
      <span className="num w-9 text-right text-[11px]">{Math.round(explode * 100)}%</span>
    </div>
  );
}

export function BusyPill() {
  const busy = useUI((s) => s.busy);
  const label = useUI((s) => s.busyLabel);
  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="shimmer absolute left-1/2 top-3 -translate-x-1/2 overflow-hidden rounded-full border border-line bg-surface/90 px-3 py-1 text-xs shadow-panel backdrop-blur"
        >
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          {label || 'Calculando…'}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ToolHint() {
  const tool = useUI((s) => s.tool);
  const draft = useUI((s) => s.draft);
  const selection = useUI((s) => s.selection);
  const count = useUI((s) => s.parts.length);
  const ops = useHistory((s) => s.doc.operations.length);
  const filaments = useHistory((s) => s.doc.filaments);
  const activeSlot = useUI((s) => s.activeSlot);

  if (tool === 'paint') {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/90 px-3 py-1.5 shadow-panel backdrop-blur">
        <span className="text-xs text-muted">Pintar com</span>
        {filaments.map((c, i) => (
          <button
            key={i}
            aria-label={`Slot ${i + 1}`}
            aria-pressed={activeSlot === i + 1}
            onClick={() => setUI({ activeSlot: i + 1 })}
            className={cx('num h-6 w-6 rounded-md border text-[10px] font-semibold', activeSlot === i + 1 ? 'border-accent ring-2 ring-accent/40' : 'border-line')}
            style={{ background: c, color: contrast(c) }}
          >
            {i + 1}
          </button>
        ))}
        <span className="text-xs text-muted">e clique nas partes</span>
        <Kbd>Esc</Kbd>
      </div>
    );
  }
  let text: React.ReactNode = null;
  if (draft) text = <>Arraste as setas para mover e os arcos para girar · <Kbd>Enter</Kbd> corta · <Kbd>Esc</Kbd> cancela</>;
  else if (count > 0 && !selection && ops === 0) text = <>Clique numa parte e pressione <Kbd>C</Kbd> para cortar</>;
  else if (selection && ops === 0) text = <>Pressione <Kbd>C</Kbd> para cortar esta parte</>;
  if (!text) return null;
  return <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line bg-surface/85 px-3 py-1 text-xs text-muted shadow-panel backdrop-blur">{text}</div>;
}

const STEPS = [
  { icon: IconCube, title: 'Importar', text: 'STL, OBJ ou 3MF — reparo automático' },
  { icon: IconCut, title: 'Cortar', text: 'Plano com gizmo e preview ao vivo' },
  { icon: IconPin, title: 'Encaixar', text: 'Pinos com folga para FDM ou resina' },
  { icon: IconExport, title: 'Exportar', text: '3MF colorido para Bambu Studio, STL' },
];

export function EmptyState() {
  const hasSources = useHistory((s) => s.doc.sources.length > 0);
  const ready = useUI((s) => s.ready);
  if (hasSources || !ready) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto w-full max-w-xl rounded-2xl border border-dashed border-line bg-surface/80 p-8 text-center shadow-panel backdrop-blur"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <IconCube size={24} />
        </div>
        <h1 className="text-lg font-semibold">Arraste um STL, OBJ ou 3MF aqui</h1>
        <p className="mt-1 text-sm text-muted">ou abra um exemplo para experimentar o fluxo completo.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" onClick={() => void openFilePicker()} data-testid="open-file">
            <IconOpen size={15} /> Abrir arquivo
          </Button>
          <Button onClick={() => void openExample()} data-testid="open-example">
            Abrir exemplo
          </Button>
        </div>
        <ol className="mt-7 grid grid-cols-2 gap-2 text-left sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg bg-surface-2 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <span className="num text-[10px] text-accent">{i + 1}</span>
                <s.icon size={14} /> {s.title}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </motion.div>
    </div>
  );
}

/** Window-wide drag & drop of model / project files. */
export function DropOverlay() {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void importFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return (
    <AnimatePresence>
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm"
        >
          <div className="text-lg font-semibold text-accent">Solte para importar</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const icon = { info: IconInfo, success: IconCheck, warning: IconAlert, error: IconAlert };
  const tone = { info: 'text-muted', success: 'text-success', warning: 'text-warning', error: 'text-danger' };
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icon[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              className="pointer-events-auto flex gap-2.5 rounded-lg border border-line bg-surface-2 p-3 shadow-panel"
            >
              <Icon size={16} className={cx('mt-px shrink-0', tone[t.kind])} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{t.title}</div>
                {t.detail && <div className="mt-0.5 text-[11px] leading-snug text-muted">{t.detail}</div>}
              </div>
              <button aria-label="Fechar" className="self-start text-muted hover:text-text" onClick={() => setUI({ toasts: useUI.getState().toasts.filter((x) => x.id !== t.id) })}>
                <IconX size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return APP_COMMANDS.filter((c) => `${c.group} ${c.label}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(n));
  }, [q]);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  if (!open) return null;
  const close = () => setUI({ paletteOpen: false });
  const run = (i: number) => {
    const c = list[i];
    if (!c) return;
    close();
    c.run();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh] backdrop-blur-[2px]" onClick={close}>
      <motion.div
        role="dialog"
        aria-label="Paleta de comandos"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface-2 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          placeholder="Digite um comando…"
          aria-label="Buscar comando"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(list.length - 1, a + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
            if (e.key === 'Enter') run(active);
          }}
          className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
          {list.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(i)}
              className={cx('flex h-9 cursor-default items-center justify-between rounded-md px-3 text-xs', i === active && 'bg-surface-3')}
            >
              <span>
                <span className="mr-2 text-muted">{c.group}</span>
                {c.label}
              </span>
              {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-3 text-xs text-muted">Nenhum comando encontrado.</li>}
        </ul>
      </motion.div>
    </div>
  );
}
