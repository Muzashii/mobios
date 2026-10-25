import * as Tooltip from '@radix-ui/react-tooltip';
import { MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { useHistory } from '../store/history';
import { useUI } from '../store/ui';
import { ViewportBoundary } from './ViewportBoundary';
import { Inspector } from './Inspector';
import { Outliner } from './Outliner';
import { AssemblyBar, BusyPill, CommandPalette, DropOverlay, EmptyState, ExplodeSlider, Toasts, ToolHint } from './Overlays';
import { ViewControls } from './ViewControls';
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
        {/* Left: what to do now (the step). Centre: the model. Right: what you have (pieces, history). */}
        <div className="grid h-full grid-cols-[320px_minmax(0,1fr)_256px] grid-rows-[52px_minmax(0,1fr)] bg-bg max-lg:grid-cols-[300px_minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[52px_minmax(0,1fr)_42vh]">
          <div className="col-span-3 max-lg:col-span-2 max-md:col-span-1">
            <TopBar />
          </div>
          <div className="min-h-0 border-r border-line max-md:order-last max-md:border-r-0 max-md:border-t">
            <Inspector />
          </div>
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
              <ToolHint />
              <BusyPill />
              <ExplodeSlider />
              <AssemblyBar />
              <ViewControls />
            </div>
          </main>
          <aside aria-label="Projeto" className="flex min-h-0 flex-col border-l border-line bg-surface max-lg:hidden">
            <Outliner />
            <HistoryPanel />
          </aside>
        </div>
        <DropOverlay />
        <Toasts />
        <CommandPalette />
      </Tooltip.Provider>
    </MotionConfig>
  );
}
