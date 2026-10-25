import { AnimatePresence, motion } from 'framer-motion';
import { ConnectorInspector } from '../features/connectors/ConnectorInspector';
import { LabelInspector } from '../features/connectors/LabelInspector';
import { HollowInspector } from '../features/analysis/PrintPrep';
import { useHistory } from '../store/history';
import { CutInspector } from '../features/cut/CutInspector';
import { SmartCutInspector } from '../features/smartcut/SmartCutInspector';
import { XRayPanel } from '../features/import/XRayPanel';
import { ColorStep } from '../features/steps/ColorStep';
import { FitStep } from '../features/steps/FitStep';
import { ModelStep } from '../features/steps/ModelStep';
import { SplitStep } from '../features/steps/SplitStep';
import { useUI } from '../store/ui';

const STEPS = { model: ModelStep, split: SplitStep, fit: FitStep, color: ColorStep };

/**
 * The side panel: the current step of the flow, or — while a task is open (reviewing a cut,
 * brushing, editing a pin, repairing a mesh) — that task, with its own way back.
 */
export function Inspector() {
  const step = useUI((s) => s.step);
  const draft = useUI((s) => s.draft);
  const connectorEdit = useUI((s) => s.connectorEdit);
  const brushing = useUI((s) => s.tool === 'brush' && s.brushAdvanced);
  const xray = useUI((s) => (s.xray ? `${s.xray.index}` : null));
  const editKind = useHistory((s) => s.doc.operations.find((o) => o.id === connectorEdit)?.kind);
  const Step = STEPS[step];

  const key = xray !== null ? `xray-${xray}` : draft ? `cut-${draft.editingOpId ?? 'new'}` : brushing ? 'brush' : connectorEdit ? `k-${connectorEdit}` : step;
  return (
    <aside id="inspector" tabIndex={-1} aria-label="Inspector" className="relative h-full overflow-hidden bg-surface">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          className="absolute inset-0"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.14 }}
        >
          {xray !== null ? (
            <XRayPanel />
          ) : draft ? (
            <CutInspector draft={draft} />
          ) : brushing ? (
            <SmartCutInspector />
          ) : connectorEdit ? (
            editKind === 'label' ? <LabelInspector opId={connectorEdit} /> : editKind === 'hollow' ? <HollowInspector opId={connectorEdit} /> : <ConnectorInspector opId={connectorEdit} />
          ) : (
            <Step />
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
