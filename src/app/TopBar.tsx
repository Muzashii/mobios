import * as Menu from '@radix-ui/react-dropdown-menu';
import { exportParts, saveProjectFile } from '../features/export/exportActions';
import { newProject, openExample, openFilePicker } from '../features/import/importActions';
import { renameProject } from '../store/commands';
import { dispatch, useHistory } from '../store/history';
import { setUI, useUI } from '../store/ui';
import { Button, IconButton, Kbd } from '../ui/components';
import { IconCommand, IconExport, IconLogo, IconMoon, IconOpen, IconRedo, IconSun, IconUndo } from '../ui/icons';
import { toggleTheme } from './commands';

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

const menuContent = 'z-50 min-w-60 rounded-lg border border-line bg-surface-2 p-1 shadow-panel';

export function TopBar() {
  const name = useHistory((s) => s.doc.name);
  const undoLabel = useHistory((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useHistory((s) => s.future[0]?.label);
  const theme = useUI((s) => s.theme);
  const hasParts = useUI((s) => s.parts.length > 0);
  const { undo, redo } = useHistory.getState();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-line bg-surface px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-text">
          <IconLogo size={16} />
        </span>
        <span className="text-sm font-semibold tracking-tight">Fenda</span>
        <span className="hidden text-sm text-muted sm:inline">Studio</span>
      </div>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="sm">
            <IconOpen size={15} /> Arquivo
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className={menuContent} sideOffset={6} align="start">
            <MenuItem onSelect={() => void openFilePicker()} shortcut="Ctrl+O">Abrir modelo ou projeto…</MenuItem>
            <MenuItem onSelect={() => void openExample()}>Abrir exemplo</MenuItem>
            <Menu.Separator className="my-1 h-px bg-line" />
            <MenuItem onSelect={saveProjectFile} shortcut="Ctrl+S">Salvar projeto (.fenda)</MenuItem>
            <MenuItem onSelect={() => void newProject()}>Novo projeto</MenuItem>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <span className="hidden md:inline">Projeto:</span>
        <input
          aria-label="Nome do projeto"
          value={name}
          onChange={(e) => dispatch(renameProject(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 w-44 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-text outline-none hover:border-line focus:border-accent"
        />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <IconButton label={undoLabel ? `Desfazer: ${undoLabel}` : 'Desfazer'} shortcut="Ctrl+Z" disabled={!undoLabel} onClick={undo}>
          <IconUndo />
        </IconButton>
        <IconButton label={redoLabel ? `Refazer: ${redoLabel}` : 'Refazer'} shortcut="Ctrl+Y" disabled={!redoLabel} onClick={redo}>
          <IconRedo />
        </IconButton>
        <IconButton label="Paleta de comandos" shortcut="Ctrl+K" onClick={() => setUI({ paletteOpen: true })}>
          <IconCommand />
        </IconButton>
        <IconButton label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} onClick={toggleTheme}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </IconButton>
      </div>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="primary" disabled={!hasParts} data-testid="export-menu">
            <IconExport size={15} /> Exportar
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className={menuContent} sideOffset={6} align="end">
            <MenuItem onSelect={() => void exportParts('3mf')} shortcut="Ctrl+E">3MF multi-objeto (Bambu Studio)</MenuItem>
            <MenuItem onSelect={() => void exportParts('stl-zip')}>Todas as partes — STL (.zip)</MenuItem>
            <MenuItem onSelect={() => void exportParts('obj-zip')}>Todas as partes — OBJ (.zip)</MenuItem>
            <Menu.Separator className="my-1 h-px bg-line" />
            <MenuItem onSelect={saveProjectFile}>Projeto editável (.fenda)</MenuItem>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </header>
  );
}
