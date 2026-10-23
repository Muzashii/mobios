import * as RSlider from '@radix-ui/react-slider';
import * as RSwitch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import { forwardRef, useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:brightness-110 active:brightness-95 font-semibold',
  subtle: 'bg-surface-3 text-text hover:bg-line',
  ghost: 'text-muted hover:text-text hover:bg-surface-3',
  danger: 'text-danger hover:bg-danger/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }>(
  function Button({ variant = 'subtle', size = 'md', className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-md transition-[background,filter,color] duration-150 disabled:pointer-events-none disabled:opacity-40 select-none',
          size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2 text-xs',
          variants[variant],
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num rounded border border-line bg-surface-2 px-1 py-px text-[10px] text-muted">{children}</kbd>;
}

export function Tip({ label, shortcut, children, side = 'bottom' }: { label: string; shortcut?: string; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-text shadow-panel"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean; side?: 'top' | 'right' | 'bottom' | 'left' }
>(function IconButton({ label, shortcut, active, side, className, children, ...rest }, ref) {
  return (
    <Tip label={label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        aria-label={label}
        aria-pressed={active}
        className={cx(
          'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35',
          active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-3 hover:text-text',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
});

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      <header className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
        {aside}
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2">
      <label htmlFor={id} className="truncate text-xs text-muted" title={hint ?? label}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** Numeric input in mono font with unit; commits on change (valid numbers only). */
export function NumberInput({
  id,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  unit = 'mm',
  digits = 2,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  digits?: number;
}) {
  const [text, setText] = useState(() => fmt(value, digits));
  useEffect(() => setText(fmt(value, digits)), [value, digits]);
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    onChange(clamped);
  };
  return (
    <div className="flex h-7 items-center rounded-md border border-line bg-surface-2 focus-within:border-accent">
      <input
        id={id}
        inputMode="decimal"
        className="num w-full min-w-0 bg-transparent px-2 text-xs outline-none"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setText(fmt(value, digits))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : 1;
            commit(String(value + (e.key === 'ArrowUp' ? step : -step) * mult));
          }
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {unit && <span className="pr-2 text-[11px] text-muted">{unit}</span>}
    </div>
  );
}

const fmt = (v: number, digits: number) => (Number.isFinite(v) ? String(+v.toFixed(digits)) : '');

export function Slider({ value, onChange, min, max, step, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string }) {
  return (
    <RSlider.Root
      className="relative flex h-5 w-full touch-none select-none items-center"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
    >
      <RSlider.Track className="relative h-1 grow rounded-full bg-surface-3">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={label}
        className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-surface shadow transition-transform hover:scale-110 focus-visible:outline-2"
      />
    </RSlider.Root>
  );
}

export function Switch({ id, checked, onChange, label }: { id?: string; checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <RSwitch.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
      className="relative h-[18px] w-8 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent"
    >
      <RSwitch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-text shadow transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-text" />
    </RSwitch.Root>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-7 rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-[5px] px-2 text-xs transition-colors',
            value === o.value ? 'bg-surface-3 text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({ id, value, options, onChange }: { id?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 w-full rounded-md border border-line bg-surface-2 px-1.5 text-xs text-text outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const mm = (v: number, digits = 1) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
