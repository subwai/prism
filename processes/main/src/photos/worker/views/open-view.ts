import type { IndexRun } from '#photos/worker/indexer/index-run';
import type { ViewVersion } from '@prism/catalog';
import { isTrashPlanView, needsDetails, type ViewSpec, type ViewState } from '@prism/shared';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.

/** A view a window has open, and the read of the folders it shows. */
export interface OpenView {
  viewId: string;
  spec: ViewSpec;
  version: ViewVersion;
  run: IndexRun;
}

/** A read of a scope's folders, shared by the views of that scope, and stopped once none is open. */
export interface SharedIndexRun {
  run: IndexRun;
  controller: AbortController;
  views: Set<string>;
}

/** Views of the same folders, however filtered, share one read of them. */
export function scopeKey({ directoryId, recursive }: ViewSpec) {
  return JSON.stringify([directoryId, recursive]);
}

/**
 * Whether a view needs photos' details read now instead of in the background. That is so when:
 * - its order or filters need them;
 * - its search field is open, suggesting what to filter by;
 * - it plans what to move to the Trash, which needs every photo's rating.
 */
export function needsDetailsNow(spec: ViewSpec) {
  return spec.suggesting || needsDetails(spec) || isTrashPlanView(spec);
}

/** The state of a view that windows are sent. */
export function viewStateOf({ viewId, version, run }: OpenView): ViewState {
  return {
    count: version.count,
    error: run.error,
    errorCount: run.errors.length,
    loading: !run.finished,
    unread: version.unread,
    unsupported: version.unsupported,
    version: version.version,
    viewId,
  };
}
