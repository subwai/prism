import type { ReactNode } from 'react';

/** Compact range control with a leading icon, for status-bar settings such as zoom. */
export function Slider({
  label,
  icon,
  min,
  max,
  step,
  value,
  disabled,
  onChange
}: {
  label: string;
  icon?: ReactNode;
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2.5">
      {icon}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-0.75 w-21.5 accent-accent"
      />
    </label>
  );
}
