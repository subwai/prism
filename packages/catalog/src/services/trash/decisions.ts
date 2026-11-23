import type { TrashChoices, TrashDecision, TrashEntry, TrashReason } from '@prism/shared';

/** What a row decides: its decision, the ones it offers, and whether the person chose it. */
export interface Decided {
  decision: TrashDecision;
  options: TrashDecision[];
  changed: boolean;
}

const KEEP_OR_TRASH: TrashDecision[] = ['keep', 'trash'];

/** The decisions a row offers: a matching folder can let only its own matches go. */
function optionsFor(entry: TrashEntry, reason: TrashReason): TrashDecision[] {
  if (reason === 'conflict') {
    return ['keep', 'rescue', 'trash'];
  }
  const matching = reason === 'matches' || reason === 'inside';
  return matching && entry.kind === 'directory' ? ['keep', 'only', 'trash'] : KEEP_OR_TRASH;
}

/** The decision a row has unless the person changes it. */
function defaultFor(choices: TrashChoices, reason: TrashReason): TrashDecision {
  return reason === 'matches' ? 'trash' : choices.defaults[reason];
}

/** What becomes of `entry`, in a row for `reason`: the person's decision if it offers that. */
export function decide(choices: TrashChoices, entry: TrashEntry, reason: TrashReason): Decided {
  const options = optionsFor(entry, reason);
  const chosen = Object.hasOwn(choices.decisions, entry.id)
    ? choices.decisions[entry.id]
    : undefined;
  const fallback = defaultFor(choices, reason);
  if (chosen === undefined || !options.includes(chosen) || chosen === fallback) {
    return { changed: false, decision: fallback, options };
  }
  return { changed: true, decision: chosen, options };
}
