import { AnimatePresence, motion } from 'framer-motion';
import { PartInspector } from '../features/analysis/PartInspector';
import { ProjectInspector } from '../features/analysis/ProjectInspector';
import { ConnectorInspector } from '../features/connectors/ConnectorInspector';
import { CutInspector } from '../features/cut/CutInspector';
import { SmartCutInspector } from '../features/smartcut/SmartCutInspector';
import { useUI } from '../store/ui';

export function Inspector() {
  const draft = useUI((s) => s.draft);
  const connectorEdit = useUI((s) => s.connectorEdit);
  const part = useUI((s) => s.parts.find((p) => p.id === s.selection));
  const brushing = useUI((s) => s.tool === 'brush');

  const key = brushing ? 'smartcut' : draft ? `cut-${draft.editingOpId ?? 'new'}` : connectorEdit ? `k-${connectorEdit}` : part ? `part-${part.id}` : 'project';
  return (
    <aside aria-label="Inspector" className="relative h-full overflow-hidden border-l border-line bg-surface">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          className="absolute inset-0"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.14 }}
        >
          {brushing ? (
            <SmartCutInspector />
          ) : draft ? (
            <CutInspector draft={draft} />
          ) : connectorEdit ? (
            <ConnectorInspector opId={connectorEdit} />
          ) : part ? (
            <PartInspector part={part} />
          ) : (
            <ProjectInspector />
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
