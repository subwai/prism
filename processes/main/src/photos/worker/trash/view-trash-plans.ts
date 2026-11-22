import { requireString, requireTrashChoices, requireViewRange } from '#photos/validate';
import type { LibraryViews } from '#photos/worker/views/library-views';
import type { Catalog } from '@prism/catalog';
import {
  isTrashPlanView,
  type TrashChoices,
  type TrashFileList,
  type TrashPlan,
} from '@prism/shared';

/** What moving the entries a library's views show to the Trash would move, from its catalog. */
export function trashPlans(catalog: Catalog, views: LibraryViews) {
  function requirePlan(viewId: string, version: number, choices: TrashChoices) {
    requireString(viewId);
    requireViewRange(version, 0, 0);
    requireTrashChoices(choices);
    if (!isTrashPlanView(views.specOf(viewId))) {
      throw new Error('Only a view of everything inside a folder can be moved to the Trash.');
    }
  }

  return {
    /** Every entry `plan` would move, one by one; see `CatalogViews.trashFiles`. */
    files(viewId: string, version: number, choices: TrashChoices): Promise<TrashFileList | null> {
      requirePlan(viewId, version, choices);
      return catalog.call('viewTrashFiles', viewId, version, choices);
    },

    /**
     * What moving the entries a view shows to the Trash would move; see
     * `CatalogViews.trashPlan`. Only a view of everything inside a folder, folders included,
     * has one.
     */
    plan(viewId: string, version: number, choices: TrashChoices): Promise<TrashPlan | null> {
      requirePlan(viewId, version, choices);
      return catalog.call('viewTrashPlan', viewId, version, choices);
    },
  };
}
