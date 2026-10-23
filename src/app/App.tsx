import * as Tooltip from '@radix-ui/react-tooltip';
import { lazy, Suspense, useEffect } from 'react';
import { StrokeOverlay } from '../features/cut/StrokeOverlay';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { useUI } from '../store/ui';
import { ViewportBoundary } from './ViewportBoundary';
import { Inspector } from './Inspector';
import { Outliner } from './Outliner';
import { BusyPill, CommandPalette, DropOverlay, EmptyState, ExplodeSlider, Toasts, ToolHint } from './Overlays';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';

// three.js + R3F + drei load as a separate chunk so the shell paints fast.
const LazyViewport = lazy(() => import('../features/viewport/Viewport').then((m) => ({ default: m.Viewport })));

export function App() {
  const theme = useUI((s) => s.theme);
  useShortcuts();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <Tooltip.Provider>
      <div className="grid h-full grid-cols-[52px_minmax(0,1fr)_300px] grid-rows-[48px_minmax(0,1fr)_168px] bg-bg">
        <div className="col-span-3">
          <TopBar />
        </div>
        <Toolbar />
        <main className="relative overflow-hidden" aria-label="Viewport 3D">
          <Suspense fallback={<div className="shimmer absolute inset-0" />}>
            <ViewportBoundary>
              <LazyViewport />
            </ViewportBoundary>
          </Suspense>
          <StrokeOverlay />
          <div className="pointer-events-none absolute inset-0">
            <EmptyState />
            <ToolHint />
            <BusyPill />
            <ExplodeSlider />
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
  );
}
