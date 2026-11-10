import type { IndexRun } from '#photos/worker/indexer';
import type { ViewVersion } from '@prism/catalog';
import { needsDetails, type ViewSpec, type ViewState } from '@prism/shared';

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
 * filters need them, or its search field is open, suggesting what to filter by.
 */
export function wantsDetailsNow(spec: ViewSpec) {
  return spec.suggesting || needsDetails(spec);
}

/** What windows are told of a view. */
export function stateOf({ viewId, version, run }: OpenView): ViewState {
  return {
    count: version.count,
    error: run.error,
    errors: run.errors,
    loading: !run.finished,
    unread: version.unread,
    version: version.version,
    viewId,
  };
}
