import type { Shortcut } from '#components/kbd';
import { Tooltip } from '#components/tooltip';
import { Fragment, type ReactNode, useId } from 'react';

export interface Segment<Value extends string> {
  value: Value;
  label: string;
  icon: ReactNode;
  /** Tooltip text, when it should say more than the label. */
  title?: string;
  shortcut?: Shortcut;
}

/** Icon segments for switching between mutually exclusive views. */
export function SegmentedControl<Value extends string>({
  label,
  segments,
  value,
  onChange
}: {
  label: string;
  segments: Segment<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const id = useId();
  return (
    <div className="rounded-field bg-fill flex gap-0.5 p-0.5" role="group" aria-label={label}>
      {segments.map((segment) => (
        <Fragment key={segment.value}>
          <button
            type="button"
            aria-label={segment.label}
            aria-pressed={segment.value === value}
            aria-keyshortcuts={segment.shortcut?.keys}
            // oxlint-disable-next-line react/no-unknown-property -- Interest invokers; typed in tooltip.tsx.
            interestfor={`${id}-${segment.value}`}
            className="rounded-inner text-label-secondary hover:text-label aria-pressed:bg-fill-selected aria-pressed:text-label aria-pressed:shadow-raised inline-flex h-6 w-7.5 items-center justify-center"
            onClick={() => onChange(segment.value)}
          >
            {segment.icon}
          </button>
          <Tooltip
            id={`${id}-${segment.value}`}
            label={segment.title ?? segment.label}
            shortcut={segment.shortcut}
          />
        </Fragment>
      ))}
    </div>
  );
}
