import { cn } from '#cn';
import { type CSSProperties, type ReactNode, useRef } from 'react';

/** How near the default, as a share of the range, a drag snaps to it. */
const SNAP_DISTANCE = 0.08;
/** How long a drag held at the default stays snapped, after which it can stop just beside it. */
const SNAP_HOLD_MS = 700;

interface Drag {
  /** Where the pointer has put the value, which snapping may have overridden. */
  value: number;
  /** Set while the drag is snapped to the default, until holding there releases it. */
  hold?: ReturnType<typeof setTimeout>;
  released: boolean;
}

/**
 * Compact range control with a leading icon, for status-bar settings such as zoom. A class
 * name can replace the default width, say to make it a video's scrubber. `valueText` is what
 * screen readers say for the value, when the number alone would not mean much.
 *
 * With a `defaultValue`, double-clicking goes back to it, and dragging near it snaps to it. A
 * drag held there for a moment lets go, so a value just beside the default can still be picked.
 *
 * Drawn in the text colour, like the icon beside it, rather than in the accent: a control this
 * small and always on screen should not draw the eye.
 */
export function Slider({
  label,
  icon,
  min,
  max,
  step,
  value,
  defaultValue,
  valueText,
  disabled,
  className,
  onChange
}: {
  label: string;
  icon?: ReactNode;
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue?: number;
  valueText?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: number) => void;
}) {
  const drag = useRef<Drag | null>(null);
  function startDrag() {
    if (defaultValue === undefined) {
      return;
    }
    const current: Drag = { released: false, value };
    drag.current = current;
    // The pointer can leave the slider while dragging, so the drag ends wherever it is let go.
    const ended = new AbortController();
    const end = () => {
      clearTimeout(current.hold);
      drag.current = null;
      ended.abort();
    };
    addEventListener('pointerup', end, { signal: ended.signal });
    addEventListener('pointercancel', end, { signal: ended.signal });
  }
  function change(next: number) {
    const { current } = drag;
    if (!current || current.released || defaultValue === undefined) {
      onChange(next);
      return;
    }
    current.value = next;
    if (Math.abs(next - defaultValue) > (max - min) * SNAP_DISTANCE) {
      clearTimeout(current.hold);
      current.hold = undefined;
      onChange(next);
      return;
    }
    current.hold ??= setTimeout(() => {
      current.released = true;
      onChange(current.value);
    }, SNAP_HOLD_MS);
    onChange(defaultValue);
  }
  return (
    <label className="text-label-secondary flex items-center gap-2.5">
      {icon}
      <input
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onPointerDown={startDrag}
        onChange={(event) => change(Number(event.target.value))}
        onDoubleClick={defaultValue === undefined ? undefined : () => onChange(defaultValue)}
        className={cn(
          'slider-bar h-0.75 w-21.5 enabled:hover:text-label disabled:opacity-40',
          'slider-thumb:size-(--thumb) slider-thumb:appearance-none slider-thumb:rounded-full slider-thumb:bg-current slider-thumb:shadow-raised',
          className
        )}
        style={{ '--fill': (value - min) / (max - min || 1) } as CSSProperties}
      />
    </label>
  );
}
