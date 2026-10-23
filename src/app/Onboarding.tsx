import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { startCut } from '../features/cut/cutActions';
import { exportParts } from '../features/export/exportActions';
import { useHistory } from '../store/history';
import { setUI, useUI } from '../store/ui';
import { Button, Kbd, cx } from '../ui/components';
import { IconCheck, IconX } from '../ui/icons';

const KEY = 'fenda-onboarding-done';
const readDone = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
const markDone = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Private mode: the tour simply shows again next time.
  }
};

/**
 * Four-step guided tour (SPEC §5): import → cut → connector → export.
 * Steps tick off from what the user actually does, so it never gets in the way.
 */
export function Onboarding() {
  const [dismissed, setDismissed] = useState(readDone);
  const [collapsed, setCollapsed] = useState(false);
  const sources = useHistory((s) => s.doc.sources.length);
  const cuts = useHistory((s) => s.doc.operations.some((o) => o.kind === 'cut-plane' || o.kind === 'cut-surface'));
  const lastConnector = useHistory((s) => [...s.doc.operations].reverse().find((o) => o.kind === 'connector')?.id);
  const exported = useUI((s) => s.exportedOnce);
  // While a tool is in use its own hint guides the user: keep the tour to its header.
  const toolActive = useUI((s) => !!s.draft || s.tool === 'brush' || s.tool === 'draw' || s.assembly !== null);
  const steps = [
    { title: 'Importar', done: sources > 0, text: 'Arraste um STL, OBJ ou 3MF — ou abra o exemplo.' },
    {
      title: 'Cortar',
      done: cuts,
      text: (
        <>
          Selecione a parte e pressione <Kbd>C</Kbd> (plano) ou <Kbd>S</Kbd> (SmartCut). Arraste o gizmo e confirme com <Kbd>Enter</Kbd>.
        </>
      ),
      action: { label: 'Cortar agora', run: () => startCut() },
    },
    {
      title: 'Encaixe',
      done: !!lastConnector && cuts,
      text: 'O corte já vem com pino e folga para sua impressora. Ajuste o tipo e a folga no histórico.',
      action: lastConnector ? { label: 'Ver encaixe', run: () => setUI({ connectorEdit: lastConnector, selection: null }) } : undefined,
    },
    { title: 'Exportar', done: exported, text: '3MF com cada parte no seu slot de filamento, pronto para o Bambu Studio.', action: { label: 'Exportar 3MF', run: () => void exportParts('3mf') } },
  ];
  const current = steps.findIndex((s) => !s.done);
  const allDone = current === -1;

  useEffect(() => {
    if (!allDone || dismissed) return;
    markDone();
    const t = setTimeout(() => setDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [allDone, dismissed]);

  if (dismissed || sources === 0) return null;
  const step = steps[current] ?? null;
  return (
    <AnimatePresence>
      <motion.aside
        aria-label="Primeiros passos"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className="pointer-events-auto absolute bottom-16 left-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-line bg-surface/95 p-3 shadow-panel backdrop-blur"
        data-testid="onboarding"
      >
        <div className="flex items-center justify-between">
          <button className="text-xs font-semibold" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
            Primeiros passos · {steps.filter((s) => s.done).length}/4
          </button>
          <button
            aria-label="Fechar tour"
            className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-text"
            onClick={() => {
              markDone();
              setDismissed(true);
            }}
          >
            <IconX size={14} />
          </button>
        </div>
        <ol className="mt-2 flex gap-1" aria-hidden="true">
          {steps.map((s, i) => (
            <li key={s.title} className={cx('h-1 flex-1 rounded-full', s.done ? 'bg-success' : i === current ? 'bg-accent' : 'bg-surface-3')} />
          ))}
        </ol>
        {!collapsed && !toolActive && (
          <div className="mt-2.5">
            {allDone ? (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <IconCheck size={14} /> Tudo pronto! Bons cortes.
              </p>
            ) : (
              step && (
                <>
                  <p className="text-xs font-medium">
                    {current + 1}. {step.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted">{step.text}</p>
                  {step.action && (
                    <Button size="sm" variant="primary" className="mt-2" onClick={step.action.run}>
                      {step.action.label}
                    </Button>
                  )}
                </>
              )
            )}
          </div>
        )}
      </motion.aside>
    </AnimatePresence>
  );
}
