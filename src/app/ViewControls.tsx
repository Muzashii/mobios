import { focus, setUI, useUI } from '../store/ui';
import { IconButton } from '../ui/components';
import { IconAssembly, IconBed, IconExplode, IconFocus } from '../ui/icons';
import { toggleAssembly, toggleExplode } from './commands';

/** How to look at the model: a small vertical pill on the canvas edge (no tools here — tools live in the steps). */
export function ViewControls() {
  const explode = useUI((s) => s.explode);
  const showBed = useUI((s) => s.showBed);
  const assembling = useUI((s) => s.assembly !== null);
  const hasJoints = useUI((s) => s.joints.length > 0);
  const hasParts = useUI((s) => s.parts.length > 0);
  if (!hasParts) return null;
  return (
    <nav aria-label="Vista" className="pointer-events-auto absolute right-3 top-3 flex flex-col gap-0.5 rounded-xl border border-line bg-surface/90 p-1 shadow-panel backdrop-blur">
      <IconButton side="left" label="Focar" shortcut="F" onClick={() => focus(useUI.getState().selection ?? 'all')}>
        <IconFocus />
      </IconButton>
      <IconButton side="left" label="Vista explodida" shortcut="E" active={explode > 0} onClick={toggleExplode}>
        <IconExplode />
      </IconButton>
      <IconButton side="left" label="Simular montagem" shortcut="M" active={assembling} disabled={!hasJoints} onClick={toggleAssembly} data-testid="tool-assembly">
        <IconAssembly />
      </IconButton>
      <IconButton side="left" label="Volume da impressora" active={showBed} onClick={() => setUI({ showBed: !showBed })}>
        <IconBed />
      </IconButton>
    </nav>
  );
}
