import type { Shortcut } from '#components/kbd';
import { Tooltip } from '#components/tooltip';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Fragment, type ReactNode, useId } from 'react';

export interface Segment<Value extends string> {
  value: Value;
  label: string;
  icon: ReactNode;
  /** Tooltip text, when it should say more than the label. */
  title?: string;
  shortcut?: Shortcut;
}

/**
 * Icon segments for switching between mutually exclusive views. Base UI's toggle group makes it
 * one stop for Tab, with the arrow keys moving between segments and Enter or Space choosing.
 */
export function SegmentedControl<Value extends string>({
  label,
  segments,
  value,
  onChange,
}: {
  label: string;
  segments: Segment<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const id = useId();
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      // Pressing the chosen segment would leave none chosen; a view is always showing.
      onValueChange={([next]) => next !== undefined && onChange(next)}
      className="rounded-field bg-fill flex gap-0.5 p-0.5"
    >
      {segments.map((segment) => (
        <Fragment key={segment.value}>
          <Toggle
            value={segment.value}
            aria-label={segment.label}
            aria-keyshortcuts={segment.shortcut?.keys}
            // oxlint-disable-next-line react/no-unknown-property -- Interest invokers; typed in tooltip.tsx.
            interestfor={`${id}-${segment.value}`}
            className="rounded-inner text-label-secondary hover:text-label aria-pressed:bg-fill-selected aria-pressed:text-label aria-pressed:shadow-raised icon-md inline-flex h-6 w-7.5 items-center justify-center"
          >
            {segment.icon}
          </Toggle>
          <Tooltip
            id={`${id}-${segment.value}`}
            label={segment.title ?? segment.label}
            shortcut={segment.shortcut}
          />
        </Fragment>
      ))}
    </ToggleGroup>
  );
}
