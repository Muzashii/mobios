import { exportParts, saveProjectFile } from '../features/export/exportActions';
import { exportAssemblyGuide } from '../features/export/assemblyGuide';
import { autoSplitPart } from '../features/analysis/PrintPrep';
import { addCalibration, newProject, openExample, openFilePicker } from '../features/import/importActions';
import { cancelCut, startBrush, startCut, startDraw } from '../features/cut/cutActions';
import { removeSource, setPartMeta, sourceOf } from '../store/commands';
import { dispatch, useHistory } from '../store/history';
import { saveDocNow } from '../store/persistence';
import { focus, setUI, toast, useUI, type Step } from '../store/ui';

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
    localStorage.setItem('mobios-theme', theme);
  } catch {
    // Private mode: keep it for this session only.
  }
}

export function toggleExplode() {
  const { explode } = useUI.getState();
  setUI({ explode: explode > 0 ? 0 : 0.6 });
}

export function toggleAssembly() {
  const { assembly, joints } = useUI.getState();
  if (assembly !== null) {
    setUI({ assembly: null, assemblyPlaying: false });
    return;
  }
  if (!joints.length) {
    toast('info', 'Nada para montar', 'Faça um corte primeiro.');
    return;
  }
  setUI({ assembly: 0, assemblyPlaying: true, explode: 0, draft: null, tool: 'select' });
}

export function toggleSelectedVisibility() {
  const { selection } = useUI.getState();
  if (!selection) return;
  const visible = useHistory.getState().doc.partMeta[selection]?.visible !== false;
  dispatch(setPartMeta(selection, { visible: !visible }, visible ? 'Ocultar parte' : 'Mostrar parte'));
}

/** Deletes the imported model the selected part comes from (with its cuts); Ctrl+Z brings it back. */
export function deleteSelectedModel(part = useUI.getState().selection) {
  if (!part) return;
  const doc = useHistory.getState().doc;
  const source = sourceOf(doc, part);
  if (!source) {
    toast('info', 'Esta peça não vem de um modelo importado', 'Pinos soltos somem junto com o corte que os criou.');
    return;
  }
  const name = doc.sources.find((s) => s.id === source)?.name ?? 'modelo';
  dispatch(removeSource(source, name));
  setUI({ selection: null, connectorEdit: null });
  toast('success', `${name} excluído`, 'Ctrl+Z desfaz.');
}

/** Opens a step of the flow in the side panel, closing whatever task was open. */
export function goToStep(step: Step) {
  cancelCut();
  setUI({ step, tool: 'select', brushAdvanced: false, connectorEdit: null, mapHover: null });
}

/** Single registry: drives the command palette (Ctrl+K) and documents shortcuts. */
export const APP_COMMANDS: AppCommand[] = [
  { id: 'open', label: 'Abrir modelo (STL, OBJ, 3MF, .mobios)', shortcut: 'Ctrl+O', group: 'Arquivo', run: () => void openFilePicker() },
  { id: 'example', label: 'Abrir exemplo', group: 'Arquivo', run: () => void openExample() },
  { id: 'save', label: 'Salvar projeto (.mobios)', shortcut: 'Ctrl+S', group: 'Arquivo', run: saveProjectFile },
  { id: 'new', label: 'Novo projeto', group: 'Arquivo', run: () => void newProject() },
  { id: 'export-3mf', label: 'Exportar 3MF multi-objeto (Bambu Studio)', shortcut: 'Ctrl+E', group: 'Exportar', run: () => void exportParts('3mf') },
  { id: 'export-stl', label: 'Exportar todas as partes em STL (.zip)', group: 'Exportar', run: () => void exportParts('stl-zip') },
  { id: 'export-obj', label: 'Exportar todas as partes em OBJ (.zip)', group: 'Exportar', run: () => void exportParts('obj-zip') },
  { id: 'guide', label: 'Guia de montagem (HTML com imagens)', group: 'Exportar', run: () => void exportAssemblyGuide() },
  {
    id: 'autosplit',
    label: 'Dividir parte selecionada para caber na mesa',
    group: 'Ferramentas',
    run: () => {
      const { selection, parts } = useUI.getState();
      const id = selection ?? (parts.length === 1 ? parts[0].id : null);
      if (id) void autoSplitPart(id);
      else toast('info', 'Selecione uma parte primeiro');
    },
  },
  { id: 'cut', label: 'Corte por plano', shortcut: 'C', group: 'Ferramentas', run: () => startCut() },
  { id: 'select', label: 'Selecionar', shortcut: 'V', group: 'Ferramentas', run: () => setUI({ tool: 'select' }) },
  { id: 'step-model', label: 'Etapa 1 — Modelo', shortcut: '1', group: 'Etapas', run: () => goToStep('model') },
  { id: 'step-split', label: 'Etapa 2 — Separar', shortcut: '2', group: 'Etapas', run: () => goToStep('split') },
  { id: 'step-fit', label: 'Etapa 3 — Encaixes', shortcut: '3', group: 'Etapas', run: () => goToStep('fit') },
  { id: 'step-color', label: 'Etapa 4 — Cores', shortcut: '4', group: 'Etapas', run: () => goToStep('color') },
  { id: 'smartcut', label: 'Separar por parte (apontar e clicar)', shortcut: 'S', group: 'Ferramentas', run: () => startBrush() },
  {
    id: 'brush',
    label: 'Corte com pincel',
    shortcut: 'B',
    group: 'Ferramentas',
    run: () => {
      startBrush();
      setUI({ brushAdvanced: true });
    },
  },
  { id: 'draw', label: 'Corte por curva livre', shortcut: 'L', group: 'Ferramentas', run: () => startDraw() },
  { id: 'paint', label: 'Pintar peças (slots de filamento)', shortcut: 'T', group: 'Ferramentas', run: () => setUI({ tool: 'paint', step: 'color', draft: null }) },
  { id: 'assembly', label: 'Simular montagem (animação)', shortcut: 'M', group: 'Visualizar', run: toggleAssembly },
  { id: 'explode', label: 'Alternar vista explodida', shortcut: 'E', group: 'Visualizar', run: toggleExplode },
  { id: 'focus', label: 'Focar seleção / tudo', shortcut: 'F', group: 'Visualizar', run: () => focus(useUI.getState().selection ?? 'all') },
  { id: 'hide', label: 'Ocultar/mostrar parte selecionada', shortcut: 'H', group: 'Visualizar', run: toggleSelectedVisibility },
  { id: 'delete', label: 'Excluir modelo da parte selecionada', shortcut: 'Del', group: 'Editar', run: () => deleteSelectedModel() },
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
