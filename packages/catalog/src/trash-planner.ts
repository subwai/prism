import { APPLE_DOUBLE, ownersOf } from '#attachments';
import { addCounts, countOf, noCounts } from '#trash-counts';
import { decide, type Decided } from '#trash-decisions';
import { merged, moved, type Outcome, stays, trashed, withRow } from '#trash-outcomes';
import { childrenOf, groupsOf } from '#trash-tree';
import type {
  TrashChoices,
  TrashCounts,
  TrashEntry,
  TrashPlan,
  TrashReason,
  TrashRow,
} from '@prism/shared';

/** An entry inside the folder a plan is of, as the planner judges it. */
export interface PlanEntry extends TrashEntry {
  /** Whether the view's search and filters let it through. */
  matches: boolean;
}

/** What the planner reads as it walks the tree. */
interface Planning {
  children: Map<string, PlanEntry[]>;
  choices: TrashChoices;
}

/** Inside a matching folder, whose contents go with it. */
interface Region {
  /** The matching folder, whose parent rescued entries move to. */
  governor: TrashEntry;
  /** Inside a conflict trashed with everything in it, so nothing here is a row. */
  silent: boolean;
}

/** Where in the tree the planner is. */
interface Context {
  region: Region | null;
  /** What a match is here: inside a folder kept as a conflict, matches stay unless chosen. */
  reason: 'inside' | 'matches';
}

/** What becomes of a folder's contents. */
interface Contents extends Outcome {
  /** Everything inside leaves. */
  whole: boolean;
  /** Something inside leaves, other than files that only go with the folder. */
  anything: boolean;
  /** Files that go only if the folder does, as an AppleDouble file of nothing here. */
  clutter: TrashCounts;
}

/** `entry` as the window is shown it. */
export function trashEntry({
  exif,
  id,
  kind,
  modifiedMs,
  name,
  parentId,
  rating,
  size,
}: PlanEntry): TrashEntry {
  const shown: TrashEntry = { id, kind, modifiedMs, name, parentId, size };
  if (rating !== undefined) {
    shown.rating = rating;
  }
  if (exif !== undefined) {
    shown.exif = exif;
  }
  return shown;
}

function rowOf(
  entry: PlanEntry,
  reason: TrashReason,
  decided: Decided,
  outcome: Outcome,
  more: Partial<Pick<TrashRow, 'conflicts' | 'rescueTo'>> = {},
): TrashRow {
  return {
    attachments: [],
    conflicts: 0,
    contents: outcome.counts,
    entry: trashEntry(entry),
    reason,
    ...decided,
    ...more,
  };
}

/** Rated, but its rating or name would not let it through: the person said otherwise of it. */
function isConflict(entry: PlanEntry): boolean {
  return entry.rating !== undefined && !entry.matches;
}

/** A conflict's row: it stays as `keep` says, goes as `trash` says, or moves out. */
function conflictOutcome(
  planning: Planning,
  entry: PlanEntry,
  region: Region,
  outcomes: { keep: () => Outcome; trash: () => Outcome },
): Outcome {
  const decided = decide(planning.choices, entry, 'conflict');
  const to = region.governor.parentId;
  const outcome =
    decided.decision === 'rescue'
      ? moved(entry, to)
      : (decided.decision === 'trash' ? outcomes.trash : outcomes.keep)();
  const row = rowOf(entry, 'conflict', decided, outcome, { rescueTo: to });
  return { ...withRow(outcome, row), conflicts: outcome.conflicts + 1 };
}

function mediaOutcome(planning: Planning, entry: PlanEntry, context: Context): Outcome {
  const { region } = context;
  if (region) {
    if (region.silent || !isConflict(entry)) {
      return trashed(entry);
    }
    return conflictOutcome(planning, entry, region, { keep: stays, trash: () => trashed(entry) });
  }
  if (!entry.matches) {
    return stays();
  }
  const decided = decide(planning.choices, entry, context.reason);
  const outcome = decided.decision === 'trash' ? trashed(entry) : stays();
  return withRow(outcome, rowOf(entry, context.reason, decided, outcome));
}

/** A sidecar or AppleDouble file, which goes, or moves, only with what it belongs to. */
function attachmentOutcome(
  file: PlanEntry,
  owners: TrashEntry[],
  outcomes: Map<string, Outcome>,
): Outcome {
  const fates = owners.map((owner) => outcomes.get(owner.id));
  const [first] = fates;
  let outcome = stays();
  if (fates.every((fate) => fate?.leaves === 'trash')) {
    outcome = trashed(file);
  } else if (fates.every((fate) => fate?.leaves === 'move') && first?.moves[0]) {
    outcome = moved(file, first.moves[0].to);
  }
  const row = first?.rows.find((candidate) => candidate.entry.id === owners[0]?.id);
  if (outcome.leaves && row) {
    row.attachments.push(file.id);
  }
  return outcome;
}

/** A file that alone keeps its folder from being left empty, as a RAW file can. */
function leftoverOutcome(planning: Planning, file: PlanEntry): Outcome {
  const decided = decide(planning.choices, file, 'leftover');
  const outcome = decided.decision === 'trash' ? trashed(file) : stays();
  return withRow(outcome, rowOf(file, 'leftover', decided, outcome));
}

/** What becomes of what is inside `folder`: folders and media first, which files follow. */
function contentsOf(planning: Planning, folder: TrashEntry, context: Context): Contents {
  const children = planning.children.get(folder.id) ?? [];
  const outcomes = new Map<string, Outcome>();
  for (const child of children.filter((entry) => entry.kind !== 'file')) {
    outcomes.set(
      child.id,
      child.kind === 'directory'
        ? folderOutcome(planning, child, context)
        : mediaOutcome(planning, child, context),
    );
  }
  const others = [...outcomes.values()];
  const othersLeave = others.length > 0 && others.every((outcome) => outcome.leaves !== null);
  let clutter = noCounts();
  for (const file of children.filter((entry) => entry.kind === 'file')) {
    const owners = ownersOf(file, children);
    if (owners.length > 0) {
      outcomes.set(file.id, attachmentOutcome(file, owners, outcomes));
    } else if (context.region) {
      outcomes.set(file.id, trashed(file));
    } else if (file.name.startsWith(APPLE_DOUBLE)) {
      clutter = addCounts(clutter, countOf(file));
    } else {
      outcomes.set(file.id, othersLeave ? leftoverOutcome(planning, file) : stays());
    }
  }
  const all = [...outcomes.values()];
  return {
    ...merged(all),
    anything: all.some((outcome) => outcome.leaves !== null),
    clutter,
    leaves: null,
    whole: all.every((outcome) => outcome.leaves !== null),
  };
}

/** `folder` going to the Trash with its contents if they all leave, or else what of them does. */
function withContents(folder: TrashEntry, contents: Contents): Outcome {
  const outcome = { ...merged([contents]), leaves: null };
  if (!contents.whole) {
    return outcome;
  }
  const inside = addCounts(contents.counts, contents.clutter);
  return {
    ...outcome,
    counts: addCounts(countOf(folder), inside),
    leaves: 'trash',
    targets: [folder.id],
  };
}

/** A folder that matches: it goes with everything inside it, or only its own matches do. */
function matchingOutcome(
  planning: Planning,
  folder: PlanEntry,
  reason: Context['reason'],
): Outcome {
  const decided = decide(planning.choices, folder, reason);
  const region = { governor: folder, silent: false };
  const going = withContents(folder, contentsOf(planning, folder, { reason, region }));
  const outcomes = {
    keep: stays,
    only: () =>
      withContents(folder, contentsOf(planning, folder, { reason: 'matches', region: null })),
    rescue: stays,
    trash: () => going,
  };
  const outcome = outcomes[decided.decision]();
  const row = rowOf(folder, reason, decided, outcome, { conflicts: going.conflicts });
  return withRow({ ...outcome, conflicts: 0 }, row);
}

/** A folder that does not match: what leaves inside it, or all of it if that leaves it empty. */
function plainOutcome(planning: Planning, folder: PlanEntry, reason: Context['reason']): Outcome {
  const contents = contentsOf(planning, folder, { reason, region: null });
  // A rated folder that does not match was rated to keep, so it stays, however empty.
  if (folder.rating !== undefined || !contents.whole || !contents.anything) {
    return withContents(folder, { ...contents, whole: false });
  }
  const decided = decide(planning.choices, folder, 'empty');
  // Going, it stands for everything inside it; kept, only the folder stays, emptied.
  const outcome =
    decided.decision === 'trash'
      ? { ...withContents(folder, contents), rows: [] }
      : withContents(folder, { ...contents, whole: false });
  return withRow(outcome, rowOf(folder, 'empty', decided, outcome));
}

function folderOutcome(planning: Planning, folder: PlanEntry, context: Context): Outcome {
  const { region, reason } = context;
  if (!region) {
    return folder.matches
      ? matchingOutcome(planning, folder, reason)
      : plainOutcome(planning, folder, reason);
  }
  if (region.silent || !isConflict(folder)) {
    return withContents(folder, contentsOf(planning, folder, context));
  }
  return conflictOutcome(planning, folder, region, {
    // Kept, with what inside it matches on its own staying unless the person says otherwise.
    keep: () =>
      withContents(folder, {
        ...contentsOf(planning, folder, { reason: 'inside', region: null }),
        whole: false,
      }),
    trash: () =>
      withContents(
        folder,
        contentsOf(planning, folder, { reason, region: { ...region, silent: true } }),
      ),
  });
}

/**
 * What moving the matches inside `folderId` to the Trash would do, of `entries`, everything
 * inside it in the order to show them, as `choices` decide each row. A matching folder goes
 * with everything inside it but its conflicts, which stay, go or move out of it, as decided. A
 * folder everything inside is leaving goes too. Files no view shows go with the photo they
 * belong to, or with their folder, and otherwise keep it unless decided otherwise.
 */
export function planTrash(
  folderId: string,
  entries: PlanEntry[],
  choices: TrashChoices,
): TrashPlan {
  const planning: Planning = { children: childrenOf(entries), choices };
  const root: TrashEntry = {
    id: folderId,
    kind: 'directory',
    modifiedMs: null,
    name: '',
    parentId: '',
    size: null,
  };
  const contents = contentsOf(planning, root, { reason: 'matches', region: null });
  return {
    groups: groupsOf(contents.rows),
    moves: contents.moves,
    rescued: contents.rescued,
    targets: contents.targets,
    totals: contents.counts,
  };
}
