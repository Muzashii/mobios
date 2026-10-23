import { exportParts, saveProjectFile } from '../features/export/exportActions';
import { addCalibration, newProject, openExample, openFilePicker } from '../features/import/importActions';
import { startBrush, startCut, startDraw } from '../features/cut/cutActions';
import { setPartMeta } from '../store/commands';
import { dispatch, useHistory } from '../store/history';
import { saveDocNow } from '../store/persistence';
import { focus, setUI, toast, useUI } from '../store/ui';

export interface AppCommand {
  id: string;
  label: string;
  shortcut?: string;
  group: string;
  run: () => void;
}

export function toggleTheme() {
  const theme = useUI.getState().theme === 'dark' ? 'light' : 'dark';
  setUI({ theme });
  try {
    localStorage.setItem('fenda-theme', theme);
  } catch {
    // Private mode: keep it for this session only.
  }
}

export function toggleExplode() {
  const { explode } = useUI.getState();
  setUI({ explode: explode > 0 ? 0 : 0.6 });
}

export function toggleSelectedVisibility() {
  const { selection } = useUI.getState();
  if (!selection) return;
  const visible = useHistory.getState().doc.partMeta[selection]?.visible !== false;
  dispatch(setPartMeta(selection, { visible: !visible }, visible ? 'Ocultar parte' : 'Mostrar parte'));
}

/** Single registry: drives the command palette (Ctrl+K) and documents shortcuts. */
export const APP_COMMANDS: AppCommand[] = [
  { id: 'open', label: 'Abrir modelo (STL, OBJ, 3MF, .fenda)', shortcut: 'Ctrl+O', group: 'Arquivo', run: () => void openFilePicker() },
  { id: 'example', label: 'Abrir exemplo', group: 'Arquivo', run: () => void openExample() },
  { id: 'save', label: 'Salvar projeto (.fenda)', shortcut: 'Ctrl+S', group: 'Arquivo', run: saveProjectFile },
  { id: 'new', label: 'Novo projeto', group: 'Arquivo', run: () => void newProject() },
  { id: 'export-3mf', label: 'Exportar 3MF multi-objeto (Bambu Studio)', shortcut: 'Ctrl+E', group: 'Exportar', run: () => void exportParts('3mf') },
  { id: 'export-stl', label: 'Exportar todas as partes em STL (.zip)', group: 'Exportar', run: () => void exportParts('stl-zip') },
  { id: 'export-obj', label: 'Exportar todas as partes em OBJ (.zip)', group: 'Exportar', run: () => void exportParts('obj-zip') },
  { id: 'cut', label: 'Corte por plano', shortcut: 'C', group: 'Ferramentas', run: () => startCut() },
  { id: 'select', label: 'Selecionar', shortcut: 'V', group: 'Ferramentas', run: () => setUI({ tool: 'select' }) },
  { id: 'smartcut', label: 'SmartCut — pincelar região e sugerir corte', shortcut: 'S', group: 'Ferramentas', run: () => startBrush() },
  { id: 'brush', label: 'Pincel de seleção', shortcut: 'B', group: 'Ferramentas', run: () => startBrush() },
  { id: 'draw', label: 'Corte por curva livre', shortcut: 'L', group: 'Ferramentas', run: () => startDraw() },
  { id: 'paint', label: 'Pintar partes (slots de filamento)', shortcut: 'T', group: 'Ferramentas', run: () => setUI({ tool: 'paint', draft: null }) },
  { id: 'explode', label: 'Alternar vista explodida', shortcut: 'E', group: 'Visualizar', run: toggleExplode },
  { id: 'focus', label: 'Focar seleção / tudo', shortcut: 'F', group: 'Visualizar', run: () => focus(useUI.getState().selection ?? 'all') },
  { id: 'hide', label: 'Ocultar/mostrar parte selecionada', shortcut: 'H', group: 'Visualizar', run: toggleSelectedVisibility },
  { id: 'bed', label: 'Mostrar/ocultar volume da impressora', group: 'Visualizar', run: () => setUI({ showBed: !useUI.getState().showBed }) },
  { id: 'theme', label: 'Alternar tema claro/escuro', group: 'Visualizar', run: toggleTheme },
  { id: 'calibration', label: 'Gerar peça de calibração de folga', group: 'Encaixes', run: () => void addCalibration() },
  { id: 'undo', label: 'Desfazer', shortcut: 'Ctrl+Z', group: 'Editar', run: () => useHistory.getState().undo() },
  { id: 'redo', label: 'Refazer', shortcut: 'Ctrl+Y', group: 'Editar', run: () => useHistory.getState().redo() },
  {
    id: 'persist',
    label: 'Salvar no navegador agora',
    group: 'Arquivo',
    run: () => void saveDocNow(useHistory.getState().doc).then((ok) => toast(ok ? 'success' : 'error', ok ? 'Projeto salvo no navegador' : 'Não foi possível salvar')),
  },
];

export const runCommand = (id: string) => APP_COMMANDS.find((c) => c.id === id)?.run();
