import { type PlanEntry, planTrash } from '#trash-planner';
import {
  noTrashChoices,
  type PhotoEntry,
  type Rating,
  type TrashChoices,
  type TrashDefaults,
  type TrashPlan,
} from '@prism/shared';
import path from 'node:path';

const KINDS: Record<string, PhotoEntry['kind']> = {
  '': 'directory',
  '.jpg': 'image',
  '.mov': 'video',
};

/**
 * Entries at `ids`, each a folder if it has no extension, a photo or video by its extension, and
 * a file otherwise, as AppleDouble files are. `★n` after an ID rates it, and `!` marks it as matching.
 */
export function tree(...specs: string[]): PlanEntry[] {
  return specs.map((described) => {
    const [id = '', ...marks] = described.split(' ');
    const stars = marks.find((mark) => mark.startsWith('★'));
    const name = path.basename(id);
    const planned: PlanEntry = {
      id,
      kind: name.startsWith('._') ? 'file' : (KINDS[path.extname(name)] ?? 'file'),
      matches: marks.includes('!'),
      modifiedMs: 1000,
      name,
      parentId: path.dirname(id),
      size: 10,
    };
    if (stars) {
      planned.rating = Number(stars.slice(1)) as Rating;
    }
    return planned;
  });
}

export function plan(
  entries: PlanEntry[],
  choices: { decisions?: TrashChoices['decisions']; defaults?: Partial<TrashDefaults> } = {},
  folderId = '.',
) {
  const none = noTrashChoices();
  return planTrash(folderId, entries, {
    decisions: choices.decisions ?? {},
    defaults: { ...none.defaults, ...choices.defaults },
  });
}

/** Each group's folder and its rows, as `id decision`, with `*` for those decided by hand. */
export function rowsOf({ groups }: TrashPlan) {
  return groups.map((group) => [
    group.folderId,
    group.rows.map((row) => `${row.entry.id} ${row.decision}${row.changed ? '*' : ''}`),
  ]);
}

/** The row of the entry `id`. */
export function rowAt({ groups }: TrashPlan, id: string) {
  return groups.flatMap((group) => group.rows).find((row) => row.entry.id === id);
}
