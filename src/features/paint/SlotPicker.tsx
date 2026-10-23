import { setPartMeta } from '../../store/commands';
import { dispatch, useHistory } from '../../store/history';
import { cx } from '../../ui/components';

/** Assigns a part to one of the 4 filament slots (AMS / AMS lite / BMCU), or automatic colour. */
export function SlotPicker({ partId }: { partId: string }) {
  const doc = useHistory((s) => s.doc);
  const slot = doc.partMeta[partId]?.slot;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Slot de filamento">
      <button
        role="radio"
        aria-checked={!slot}
        onClick={() => dispatch(setPartMeta(partId, { slot: undefined }, 'Cor automática'))}
        className={cx('h-6 rounded-md border px-1.5 text-[10px]', !slot ? 'border-accent text-text' : 'border-line text-muted hover:text-text')}
      >
        Auto
      </button>
      {doc.filaments.map((color, i) => (
        <button
          key={i}
          role="radio"
          aria-checked={slot === i + 1}
          aria-label={`Slot ${i + 1}`}
          title={`Slot ${i + 1}`}
          onClick={() => dispatch(setPartMeta(partId, { slot: i + 1 }, `Slot ${i + 1}`))}
          className={cx('num relative h-6 w-6 rounded-md border text-[10px] font-semibold', slot === i + 1 ? 'border-accent ring-2 ring-accent/40' : 'border-line')}
          style={{ background: color, color: contrast(color) }}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

export function contrast(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}
