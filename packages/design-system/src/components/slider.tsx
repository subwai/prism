import { cn } from '#cn';
import type { ReactNode } from 'react';

/**
 * Compact range control with a leading icon, for status-bar settings such as zoom. A class
 * name can replace the default width, say to make it a video's scrubber. `valueText` is what
 * screen readers say for the value, when the number alone would not mean much.
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
    <label className="flex items-center gap-2.5">
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
        className={cn('h-0.75 w-21.5 accent-accent', className)}
      />
    </label>
  );
}
