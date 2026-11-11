import { tv } from '#cn';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';

export interface Choice<Value extends string> {
  value: Value;
  label: string;
  /** `danger` tints it while chosen, for a choice that removes something. */
  tone?: 'danger' | 'plain';
}

const choice = tv({
  base: 'inline-flex h-5.5 items-center rounded-inner px-2 text-sm text-label-secondary hover:text-label aria-pressed:bg-fill-selected aria-pressed:shadow-raised',
  defaultVariants: { tone: 'plain' },
  variants: {
    tone: {
      danger: 'aria-pressed:text-danger',
      plain: 'aria-pressed:text-label',
    },
  },
});

/**
 * A choice between a few named outcomes, one click each, such as keep or trash. Base UI's
 * toggle group makes it one stop for Tab, with the arrow keys moving between choices and Enter
 * or Space choosing. Unlike `SegmentedControl`, its choices are words, so it fits in a row.
 */
export function ChoiceToggle<Value extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: Choice<Value>[];
  /** `null` when none is chosen, as for rows decided differently. */
  value: Value | null;
  onChange: (value: Value) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={value === null ? [] : [value]}
      // Pressing the chosen one would leave none chosen; something always becomes of it.
      onValueChange={([next]) => next !== undefined && onChange(next)}
      className="rounded-field bg-fill flex shrink-0 gap-0.5 p-0.5"
    >
      {choices.map((option) => (
        <Toggle key={option.value} value={option.value} className={choice({ tone: option.tone })}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
