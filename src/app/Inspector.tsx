import { AnimatePresence, motion } from 'framer-motion';
import { PartInspector } from '../features/analysis/PartInspector';
import { ProjectInspector } from '../features/analysis/ProjectInspector';
import { ConnectorInspector } from '../features/connectors/ConnectorInspector';
import { LabelInspector } from '../features/connectors/LabelInspector';
import { HollowInspector } from '../features/analysis/PrintPrep';
import { useHistory } from '../store/history';
import { CutInspector } from '../features/cut/CutInspector';
import { SmartCutInspector } from '../features/smartcut/SmartCutInspector';
import { useUI } from '../store/ui';

export function Inspector() {
  const draft = useUI((s) => s.draft);
  const connectorEdit = useUI((s) => s.connectorEdit);
  const part = useUI((s) => s.parts.find((p) => p.id === s.selection));
  const brushing = useUI((s) => s.tool === 'brush');
  const editKind = useHistory((s) => s.doc.operations.find((o) => o.id === connectorEdit)?.kind);

  const key = brushing ? 'smartcut' : draft ? `cut-${draft.editingOpId ?? 'new'}` : connectorEdit ? `k-${connectorEdit}` : part ? `part-${part.id}` : 'project';
  return (
    <aside id="inspector" tabIndex={-1} aria-label="Inspector" className="relative h-full overflow-hidden border-l border-line bg-surface">
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
            editKind === 'label' ? <LabelInspector opId={connectorEdit} /> : editKind === 'hollow' ? <HollowInspector opId={connectorEdit} /> : <ConnectorInspector opId={connectorEdit} />
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
