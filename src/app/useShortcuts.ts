import { useEffect } from 'react';
import { cancelCut, commitCut, suggestFromBrush } from '../features/cut/cutActions';
import { useHistory } from '../store/history';
import { setUI, useUI } from '../store/ui';
import { runCommand } from './commands';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Global keyboard shortcuts (SPEC §5). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        setUI({ paletteOpen: !useUI.getState().paletteOpen });
        return;
      }
      if (useUI.getState().paletteOpen || isTyping(e.target)) return;

      if (mod) {
        const map: Record<string, string> = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: 'save', o: 'open', e: 'export-3mf' };
        if (map[key]) {
          e.preventDefault();
          if (map[key] === 'undo' && useUI.getState().draft) cancelCut();
          runCommand(map[key]);
        }
        return;
      }
      if (e.altKey) return;

      const { draft, tool, brush } = useUI.getState();
      if (tool === 'brush') {
        if (e.key === 'Enter') {
          e.preventDefault();
          void suggestFromBrush();
          return;
        }
        if (e.key === '[' || e.key === ']') {
          const radius = Math.max(0.5, Math.min(60, brush.radius * (e.key === ']' ? 1.25 : 0.8)));
          setUI({ brush: { ...brush, radius } });
          return;
        }
      }
      if (draft) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitCut();
        } else if (e.key === 'Escape') cancelCut();
        return;
      }
      if (e.key === 'Escape') {
        setUI({ selection: null, connectorEdit: null, tool: 'select' });
        return;
      }
      const single: Record<string, string> = { c: 'cut', s: 'smartcut', b: 'brush', l: 'draw', t: 'paint', v: 'select', e: 'explode', f: 'focus', h: 'hide', m: 'assembly' };
      if (single[key]) {
        e.preventDefault();
        runCommand(single[key]);
      }
      if (key === 'p') {
        // Connector: open the newest connector, or start a cut (which adds one).
        const ops = useHistory.getState().doc.operations;
        const last = [...ops].reverse().find((o) => o.kind === 'connector');
        if (last) setUI({ connectorEdit: last.id, selection: null });
        else runCommand('cut');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
