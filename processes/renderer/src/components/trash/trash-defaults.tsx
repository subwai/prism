import {
  DECISION_LABELS,
  DEFAULT_LABELS,
  DEFAULT_REASONS,
  reasonCounts,
  withDefault,
} from '#data/trash';
import { Button, ChoiceToggle } from '@prism/design-system';
import type { TrashChoices, TrashDecision, TrashDefaults, TrashRow } from '@prism/shared';

/** The decisions each default can be. */
const OFFERED: { [Reason in keyof TrashDefaults]: TrashDefaults[Reason][] } = {
  conflict: ['keep', 'rescue', 'trash'],
  empty: ['keep', 'trash'],
  inside: ['keep', 'trash'],
  leftover: ['keep', 'trash'],
};

function choicesOf(decisions: TrashDecision[]) {
  return decisions.map((value) => ({
    label: DECISION_LABELS[value],
    tone: value === 'trash' ? ('danger' as const) : ('plain' as const),
    value,
  }));
}

/**
 * A switch for each kind of row that needs a decision, deciding every row of it that the person
 * has not decided by hand, and beside them a button that takes every row back to its default
 * while any is decided by hand. Kinds the plan has no rows of are left out.
 */
export function TrashDefaultsBar({
  rows,
  choices,
  onChange,
}: {
  rows: TrashRow[];
  choices: TrashChoices;
  onChange: (choices: TrashChoices) => void;
}) {
  const counts = reasonCounts(rows);
  const reasons = DEFAULT_REASONS.filter((reason) => counts[reason] > 0);
  const byHand = rows.some((row) => row.changed);
  if (reasons.length === 0 && !byHand) {
    return null;
  }
  return (
    <div className="flex items-start gap-4 px-5 pb-3">
      <dl className="grid flex-1 grid-cols-[auto_auto_1fr] items-center gap-x-4 gap-y-1.5">
        {reasons.map((reason) => (
          <div key={reason} className="contents">
            <dt className="text-sm">{DEFAULT_LABELS[reason]}</dt>
            <dd>
              <ChoiceToggle
                label={DEFAULT_LABELS[reason]}
                choices={choicesOf(OFFERED[reason])}
                value={choices.defaults[reason]}
                onChange={(decision) =>
                  onChange(withDefault(choices, reason, decision as TrashDefaults[typeof reason]))
                }
              />
            </dd>
            <dd className="text-label-secondary text-sm">
              {counts[reason].toLocaleString()} {counts[reason] === 1 ? 'row' : 'rows'}
            </dd>
          </div>
        ))}
      </dl>
      {byHand && (
        <Button onClick={() => onChange({ ...choices, decisions: {} })}>Reset to defaults</Button>
      )}
    </div>
  );
}
