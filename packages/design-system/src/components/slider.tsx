import { cn } from '#cn';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Compact range control with a leading icon, for status-bar settings such as zoom. A class
 * name can replace the default width, say to make it a video's scrubber. `valueText` is what
 * screen readers say for the value, when the number alone would not mean much.
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
  valueText?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: number) => void;
}) {
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
        onChange={(event) => onChange(Number(event.target.value))}
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
