import type { ReactNode } from 'react';

/** Title of a step panel: what this step is for, in one line. */
export function StepHeader({ n, title, text, aside }: { n: number; title: string; text: string; aside?: ReactNode }) {
  return (
    <header className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-4">
      <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
        <p className="mt-0.5 text-xs leading-snug text-muted">{text}</p>
      </div>
      {aside}
    </header>
  );
}

/** Centered hint for a step with nothing to act on yet. */
export function StepEmpty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-xs leading-relaxed text-muted">{children}</div>;
}
