import { ownersOf } from '#attachments';
import { type PlanEntry, trashEntry } from '#trash-planner';
import { childrenOf } from '#trash-tree';
import type { TrashFile, TrashFiles, TrashPlan } from '@prism/shared';

function fileOf(entry: PlanEntry, siblings: PlanEntry[], to?: string): TrashFile {
  const file: TrashFile = { entry: trashEntry(entry) };
  const [owner] = entry.kind === 'file' ? ownersOf(entry, siblings) : [];
  if (owner) {
    file.owner = owner.name;
  }
  if (to !== undefined) {
    file.to = to;
  }
  return file;
}

/**
 * Every entry inside `folderId` that `plan` moves to the Trash, one by one: its targets and
 * everything inside those that are folders, but what moves out of them first. What moves out
 * is listed once, as it moves with what is inside it.
 */
export function filesOf(folderId: string, entries: PlanEntry[], plan: TrashPlan): TrashFiles {
  const children = childrenOf(entries);
  const targets = new Set(plan.targets);
  const moves = new Map(plan.moves.map(({ id, to }) => [id, to]));
  const files: TrashFiles = { moved: [], trashed: [] };
  const visit = (parentId: string, trashed: boolean) => {
    const siblings = children.get(parentId) ?? [];
    for (const entry of siblings) {
      const to = moves.get(entry.id);
      if (to !== undefined) {
        files.moved.push(fileOf(entry, siblings, to));
        continue;
      }
      const goes = trashed || targets.has(entry.id);
      if (goes) {
        files.trashed.push(fileOf(entry, siblings));
      }
      if (entry.kind === 'directory') {
        visit(entry.id, goes);
      }
    }
  };
  visit(folderId, false);
  return files;
}
