import { DECISION_LABELS } from '#data/trash/plan';
import type { Choice } from '@prism/design-system';
import type { TrashDecision } from '@prism/shared';

/** The choices a toggle offers for `decisions`, with moving to the Trash marked as dangerous. */
export function decisionChoices<Decision extends TrashDecision>(
  decisions: Decision[],
): Choice<Decision>[] {
  return decisions.map((value) => ({
    label: DECISION_LABELS[value],
    tone: value === 'trash' ? 'danger' : 'plain',
    value,
  }));
}
