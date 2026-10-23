import { startBrush, startCut, startDraw } from '../features/cut/cutActions';
import { useHistory } from '../store/history';
import { focus, setUI, useUI } from '../store/ui';
import { IconButton } from '../ui/components';
import { IconBed, IconBrush, IconCursor, IconCut, IconExplode, IconFocus, IconPaint, IconPen, IconPin, IconAssembly } from '../ui/icons';
import { toggleAssembly, toggleExplode } from './commands';

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
    <nav aria-label="Ferramentas" className="flex h-full flex-col items-center gap-1 border-r border-line bg-surface py-2">
      <IconButton side="right" label="Selecionar" shortcut="V" active={tool === 'select' && !connectorEdit} onClick={() => setUI({ tool: 'select', draft: null })}>
        <IconCursor />
      </IconButton>
      <IconButton side="right" label="Corte por plano" shortcut="C" active={tool === 'cut' && draftMode === 'plane'} disabled={!hasParts} onClick={() => startCut()} data-testid="tool-cut">
        <IconCut />
      </IconButton>
      <IconButton side="right" label="SmartCut — pincele a região" shortcut="S" active={tool === 'brush'} disabled={!hasParts} onClick={() => startBrush()} data-testid="tool-smartcut">
        <IconBrush />
      </IconButton>
      <IconButton side="right" label="Corte por curva livre" shortcut="L" active={tool === 'draw' || draftMode === 'surface'} disabled={!hasParts} onClick={() => startDraw()} data-testid="tool-draw">
        <IconPen />
      </IconButton>
      <IconButton
        side="right"
        label={lastConnector ? 'Editar último encaixe' : 'Encaixes (crie um corte primeiro)'}
        shortcut="P"
        active={!!connectorEdit}
        disabled={!lastConnector}
        onClick={() => setUI({ connectorEdit: lastConnector, selection: null, draft: null, tool: 'select' })}
      >
        <IconPin />
      </IconButton>
      <IconButton side="right" label="Pintar partes (filamento)" shortcut="T" active={tool === 'paint'} disabled={!hasParts} onClick={() => setUI({ tool: tool === 'paint' ? 'select' : 'paint', draft: null })}>
        <IconPaint />
      </IconButton>
      <div className="my-1 h-px w-6 bg-line" />
      <IconButton side="right" label="Vista explodida" shortcut="E" active={explode > 0} disabled={!hasParts} onClick={toggleExplode}>
        <IconExplode />
      </IconButton>
      <IconButton side="right" label="Simular montagem" shortcut="M" active={assembling} disabled={!hasJoints} onClick={toggleAssembly} data-testid="tool-assembly">
        <IconAssembly />
      </IconButton>
      <IconButton side="right" label="Focar" shortcut="F" disabled={!hasParts} onClick={() => focus(useUI.getState().selection ?? 'all')}>
        <IconFocus />
      </IconButton>
      <IconButton side="right" label="Volume da impressora" active={showBed} onClick={() => setUI({ showBed: !showBed })}>
        <IconBed />
      </IconButton>
    </nav>
  );
}
