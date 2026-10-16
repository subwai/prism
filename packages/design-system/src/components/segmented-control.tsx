import { Tooltip } from '#components/tooltip';
import { Fragment, type ReactNode, useId } from 'react';

export interface Segment<Value extends string> {
  value: Value;
  label: string;
  icon: ReactNode;
  /** Tooltip text, when it should say more than the label. */
  title?: string;
  shortcut?: string;
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
    <div className="flex gap-0.5 rounded-field bg-fill p-0.5" role="group" aria-label={label}>
      {segments.map((segment) => (
        <Fragment key={segment.value}>
          <button
            type="button"
            aria-label={segment.label}
            aria-pressed={segment.value === value}
            // oxlint-disable-next-line react/no-unknown-property -- Interest invokers; typed in tooltip.tsx.
            interestfor={`${id}-${segment.value}`}
            className="inline-flex h-6 w-7.5 items-center justify-center rounded-inner text-label-secondary hover:text-label aria-pressed:bg-fill-selected aria-pressed:text-label aria-pressed:shadow-raised"
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
