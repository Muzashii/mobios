import * as Menu from '@radix-ui/react-dropdown-menu';
import { exportParts, saveProjectFile } from '../features/export/exportActions';
import { exportAssemblyGuide } from '../features/export/assemblyGuide';
import { newProject, openExample, openFilePicker } from '../features/import/importActions';
import { renameProject } from '../store/commands';
import { dispatch, useHistory } from '../store/history';
import { setUI, useUI, type Step } from '../store/ui';
import { Button, cx, IconButton, Kbd } from '../ui/components';
import { IconCheck, IconCommand, IconExport, IconLogo, IconMoon, IconOpen, IconRedo, IconSun, IconUndo } from '../ui/icons';
import { goToStep, toggleTheme } from './commands';

function MenuItem({ children, onSelect, shortcut }: { children: React.ReactNode; onSelect: () => void; shortcut?: string }) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className="flex h-8 cursor-default items-center justify-between gap-6 rounded-md px-2 text-xs outline-none data-[highlighted]:bg-surface-3"
    >
      <span>{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Menu.Item>
  );
}

/** The flow as tabs: each opens its step in the side panel; a check marks what is done. */
function Steps() {
  const step = useUI((s) => s.step);
  const ops = useHistory((s) => s.doc.operations);
  const hasModel = useHistory((s) => s.doc.sources.length > 0);
  const painted = useHistory((s) => Object.values(s.doc.partMeta).some((m) => m.slot));
  const cut = ops.some((o) => o.kind === 'cut-plane' || o.kind === 'cut-region' || o.kind === 'cut-surface');
  const fitted = ops.some((o) => o.kind === 'connector');
  const steps: { id: Step; label: string; done: boolean }[] = [
    { id: 'model', label: 'Modelo', done: hasModel },
    { id: 'split', label: 'Separar', done: cut },
    { id: 'fit', label: 'Encaixes', done: fitted },
    { id: 'color', label: 'Cores', done: painted },
  ];
  return (
    <nav aria-label="Etapas" className="flex items-center rounded-full bg-surface-2 p-0.5">
      {steps.map((st, i) => (
        <button
          key={st.id}
          onClick={() => goToStep(st.id)}
          aria-current={step === st.id ? 'step' : undefined}
          data-testid={`step-${st.id}`}
          className={cx(
            'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors',
            step === st.id ? 'bg-surface-3 font-medium text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          <span
            className={cx(
              'num flex size-[18px] items-center justify-center rounded-full text-[10px] font-semibold',
              st.done ? 'bg-accent text-accent-text' : step === st.id ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted',
            )}
          >
            {st.done ? <IconCheck size={11} /> : i + 1}
          </span>
          <span className="max-sm:sr-only">{st.label}</span>
        </button>
      ))}
    </nav>
  );
}

const menuContent = 'z-50 min-w-60 rounded-lg border border-line bg-surface-2 p-1 shadow-panel';

export function TopBar() {
  const name = useHistory((s) => s.doc.name);
  const undoLabel = useHistory((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useHistory((s) => s.future[0]?.label);
  const theme = useUI((s) => s.theme);
  const hasParts = useUI((s) => s.parts.length > 0);
  const { undo, redo } = useHistory.getState();

  return (
    <header className="flex h-12 items-center gap-2 border-b border-line bg-surface px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-text">
          <IconLogo size={16} />
        </span>
        <h1 className="text-sm font-semibold tracking-tight max-sm:sr-only">
          Mobios
        </h1>
      </div>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="sm" aria-label="Arquivo">
            <IconOpen size={15} /> <span className="max-sm:hidden">Arquivo</span>
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className={menuContent} sideOffset={6} align="start">
            <MenuItem onSelect={() => void openFilePicker()} shortcut="Ctrl+O">Abrir modelo ou projeto…</MenuItem>
            <MenuItem onSelect={() => void openExample()}>Abrir exemplo</MenuItem>
            <Menu.Separator className="my-1 h-px bg-line" />
            <MenuItem onSelect={saveProjectFile} shortcut="Ctrl+S">Salvar projeto (.mobios)</MenuItem>
            <MenuItem onSelect={() => void newProject()}>Novo projeto</MenuItem>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <input
          aria-label="Nome do projeto"
          value={name}
          onChange={(e) => dispatch(renameProject(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 w-40 min-w-0 max-md:hidden rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-text outline-none hover:border-line focus:border-accent"
        />
      </div>

      <div className="flex-1" />

      <Steps />

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <IconButton label={undoLabel ? `Desfazer: ${undoLabel}` : 'Desfazer'} shortcut="Ctrl+Z" disabled={!undoLabel} onClick={undo}>
          <IconUndo />
        </IconButton>
        <IconButton label={redoLabel ? `Refazer: ${redoLabel}` : 'Refazer'} shortcut="Ctrl+Y" disabled={!redoLabel} onClick={redo}>
          <IconRedo />
        </IconButton>
        <IconButton label="Paleta de comandos" shortcut="Ctrl+K" className="max-sm:hidden" onClick={() => setUI({ paletteOpen: true })}>
          <IconCommand />
        </IconButton>
        <IconButton label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} onClick={toggleTheme}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </IconButton>
      </div>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="primary" disabled={!hasParts} data-testid="export-menu">
            <IconExport size={15} /> <span className="max-sm:sr-only">Exportar</span>
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className={menuContent} sideOffset={6} align="end">
            <MenuItem onSelect={() => void exportParts('3mf')} shortcut="Ctrl+E">3MF multi-objeto (Bambu Studio)</MenuItem>
            <MenuItem onSelect={() => void exportParts('stl-zip')}>Todas as partes — STL (.zip)</MenuItem>
            <MenuItem onSelect={() => void exportParts('obj-zip')}>Todas as partes — OBJ (.zip)</MenuItem>
            <MenuItem onSelect={() => void exportAssemblyGuide()}>Guia de montagem (HTML com imagens)</MenuItem>
            <Menu.Separator className="my-1 h-px bg-line" />
            <MenuItem onSelect={saveProjectFile}>Projeto editável (.mobios)</MenuItem>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </header>
  );
}
