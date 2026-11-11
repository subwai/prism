import type { IndexRun } from '#photos/worker/indexer';
import type { ViewVersion } from '@prism/catalog';
import { needsDetails, plansTrash, type ViewSpec, type ViewState } from '@prism/shared';

/** A view a window has open, and the read of the folders it shows. */
export interface OpenView {
  viewId: string;
  spec: ViewSpec;
  version: ViewVersion;
  run: IndexRun;
}

/** A read of a scope's folders, shared by the views of it, and stopped once none is open. */
export interface SharedRun {
  run: IndexRun;
  controller: AbortController;
  views: Set<string>;
}

/** Views of the same folders, however narrowed, share one read of them. */
export function scopeKey({ directoryId, recursive }: ViewSpec) {
  return JSON.stringify([directoryId, recursive]);
}

/**
 * Whether a view wants photos' details read now rather than in the background: its order or
 * filters need them, its search field is open, suggesting what to filter by, or it plans what to
 * move to the Trash, which needs every photo's rating.
 */
export function wantsDetailsNow(spec: ViewSpec) {
  return spec.suggesting || needsDetails(spec) || plansTrash(spec);
}

/** What windows are told of a view. */
export function stateOf({ viewId, version, run }: OpenView): ViewState {
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
