import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { startBrush, startCut, startDraw } from '../features/cut/cutActions';
import { useHistory } from '../store/history';
import { focus, setUI, useUI } from '../store/ui';
import { cx, Tip } from '../ui/components';
import { IconBed, IconBrush, IconCursor, IconCut, IconExplode, IconFocus, IconPaint, IconPen, IconPin, IconAssembly } from '../ui/icons';
import { toggleAssembly, toggleExplode } from './commands';

/** Labeled tool: icon over a short name; the tooltip carries the full name and the shortcut. */
function Tool({ label, short, shortcut, active, toggle, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; short: string; shortcut?: string; active?: boolean; toggle?: boolean; children: ReactNode }) {
  return (
    <Tip label={label} shortcut={shortcut} side="top">
      <button
        aria-label={label}
        aria-pressed={active}
        className={cx(
          'flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35',
          // A tool is a mode (solid); a view toggle only tints.
          active ? (toggle ? 'bg-accent-soft text-accent' : 'bg-accent text-accent-text') : 'text-muted hover:bg-surface-3 hover:text-text',
        )}
        {...rest}
      >
        {children}
        <span className="hidden text-[10px] font-medium leading-none lg:block">{short}</span>
      </button>
    </Tip>
  );
}

const Divider = () => <div className="mx-1 h-8 w-px shrink-0 bg-line" aria-hidden />;

/** Floating tool dock at the bottom of the viewport, grouped by step: select · cut · fit · view. */
export function Toolbar() {
  const tool = useUI((s) => s.tool);
  const draftMode = useUI((s) => s.draft?.mode);
  const explode = useUI((s) => s.explode);
  const showBed = useUI((s) => s.showBed);
  const assembling = useUI((s) => s.assembly !== null);
  const hasJoints = useUI((s) => s.joints.length > 0);
  const connectorEdit = useUI((s) => s.connectorEdit);
  const hasParts = useUI((s) => s.parts.length > 0);
  const lastConnector = useHistory((s) => [...s.doc.operations].reverse().find((o) => o.kind === 'connector')?.id);

  return (
    <nav
      aria-label="Ferramentas"
      className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl border border-line bg-surface/95 p-1 shadow-panel backdrop-blur"
    >
      <Tool label="Selecionar" short="Selecionar" shortcut="V" active={tool === 'select' && !connectorEdit} onClick={() => setUI({ tool: 'select', draft: null })}>
        <IconCursor />
      </Tool>
      <Divider />
      <Tool label="SmartCut — aponte a parte e clique" short="SmartCut" shortcut="S" active={tool === 'brush'} disabled={!hasParts} onClick={() => startBrush()} data-testid="tool-smartcut">
        <IconBrush />
      </Tool>
      <Tool label="Corte por plano" short="Plano" shortcut="C" active={tool === 'cut' && draftMode === 'plane'} disabled={!hasParts} onClick={() => startCut()} data-testid="tool-cut">
        <IconCut />
      </Tool>
      <Tool label="Corte por curva livre" short="Traço" shortcut="L" active={tool === 'draw' || draftMode === 'surface'} disabled={!hasParts} onClick={() => startDraw()} data-testid="tool-draw">
        <IconPen />
      </Tool>
      <Divider />
      <Tool
        label={lastConnector ? 'Editar último encaixe' : 'Encaixes (crie um corte primeiro)'}
        short="Encaixe"
        shortcut="P"
        active={!!connectorEdit}
        disabled={!lastConnector}
        onClick={() => setUI({ connectorEdit: lastConnector, selection: null, draft: null, tool: 'select' })}
      >
        <IconPin />
      </Tool>
      <Tool label="Pintar partes (filamento)" short="Cores" shortcut="T" active={tool === 'paint'} disabled={!hasParts} onClick={() => setUI({ tool: tool === 'paint' ? 'select' : 'paint', draft: null })}>
        <IconPaint />
      </Tool>
      <Divider />
      <Tool label="Vista explodida" short="Explodir" shortcut="E" toggle active={explode > 0} disabled={!hasParts} onClick={toggleExplode}>
        <IconExplode />
      </Tool>
      <Tool label="Simular montagem" short="Montagem" shortcut="M" toggle active={assembling} disabled={!hasJoints} onClick={toggleAssembly} data-testid="tool-assembly">
        <IconAssembly />
      </Tool>
      <Tool label="Focar" short="Focar" shortcut="F" disabled={!hasParts} onClick={() => focus(useUI.getState().selection ?? 'all')}>
        <IconFocus />
      </Tool>
      <Tool label="Volume da impressora" short="Mesa" toggle active={showBed} onClick={() => setUI({ showBed: !showBed })}>
        <IconBed />
      </Tool>
    </nav>
  );
}
