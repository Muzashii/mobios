import * as Tooltip from '@radix-ui/react-tooltip';
import { MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { useHistory } from '../store/history';
import { useUI } from '../store/ui';
import { ViewportBoundary } from './ViewportBoundary';
import { Inspector } from './Inspector';
import { Onboarding } from './Onboarding';
import { Outliner } from './Outliner';
import { AssemblyBar, BusyPill, CommandPalette, DropOverlay, EmptyState, ExplodeSlider, Toasts, ToolHint } from './Overlays';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';

// three.js + R3F + drei load as a separate chunk so the shell paints fast.
const LazyViewport = lazy(() => import('../features/viewport/Viewport').then((m) => ({ default: m.Viewport })));
const StrokeOverlay = lazy(() => import('../features/cut/StrokeOverlay'));

export function App() {
  const theme = useUI((s) => s.theme);
  const drawing = useUI((s) => s.tool === 'draw');
  const hasModel = useHistory((s) => s.doc.sources.length > 0);
  useShortcuts();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider>
        <a
          className="skip-link"
          href="#inspector"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('inspector')?.focus();
          }}
        >
          Pular para o painel de propriedades
        </a>
        <div className="grid h-full grid-cols-[52px_minmax(0,1fr)_300px] grid-rows-[48px_minmax(0,1fr)_168px] bg-bg">
          <div className="col-span-3">
            <TopBar />
          </div>
          <Toolbar />
          <main className="relative overflow-hidden" aria-label="Viewport 3D">
            {hasModel ? (
              <Suspense fallback={<div className="shimmer absolute inset-0" />}>
                <ViewportBoundary>
                  <LazyViewport />
                </ViewportBoundary>
              </Suspense>
            ) : (
              // No model yet: skip the 3D engine entirely (fast first load, especially on phones).
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,var(--surface-2)_0%,var(--bg)_100%)]" />
            )}
            {drawing && (
              <Suspense fallback={null}>
                <StrokeOverlay />
              </Suspense>
            )}
            <div className="pointer-events-none absolute inset-0">
              <EmptyState />
              <Onboarding />
              <ToolHint />
              <BusyPill />
              <ExplodeSlider />
              <AssemblyBar />
            </div>
          </main>
          <div className="row-span-2">
            <Inspector />
          </div>
          <div className="col-span-2 flex min-h-0 border-t border-line bg-surface">
            <Outliner />
            <HistoryPanel />
          </div>
        </div>
        <DropOverlay />
        <Toasts />
        <CommandPalette />
      </Tooltip.Provider>
    </MotionConfig>
  );
}
