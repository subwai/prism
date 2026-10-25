import { arrangeEntries, extendsLineage } from '#data/entries';
import { patchEntries } from '#data/folder-changes';
import type { FolderChange, PhotoEntry, PhotosAPI, ScanBatch, ScanOptions } from '@prism/shared';

// The previous view stays on screen while the first page loads, so it can wait for most
// folders to finish; sorted results then appear once instead of reshuffling batch by batch.
// Later pages of very large folders arrive in chunks to limit re-sorting.
const FIRST_PAGE_MS = 400,
  LATER_PAGE_MS = 120;

export interface ScanState {
  entries: PhotoEntry[];
  errors: ScanBatch['errors'];
  loading: boolean;
  error: string | null;
}

export interface DirectoryScan {
  next: (signal: AbortSignal) => Promise<ScanState>;
  /** Reads the remaining pages in the background until the scan finishes or closes. */
  stream: () => void;
  /** `useSyncExternalStore` source: the state as of the last page read. */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ScanState;
  /**
   * Applies changes on disk, adding new entries wherever the scan `shows` their folder.
   * Changes during a scan wait for it to finish, since they are newer than it.
   */
  apply: (changes: FolderChange[], shows: (parentId: string) => boolean) => void;
  close: () => void;
}

/** The library owns this reader and closes it when another view or refresh replaces it. */
export async function openScan(
  api: PhotosAPI,
  options: ScanOptions,
  signal: AbortSignal,
): Promise<DirectoryScan> {
  signal.throwIfAborted();
  const scanId = await api.startScan(options);
  let closed = false;
  let state: ScanState = { entries: [], error: null, errors: [], loading: true };
  let published = state;
  const listeners = new Set<() => void>();
  const waiting: Parameters<DirectoryScan['apply']>[] = [];
  // Each page appends to the last, so views sort only what it adds.
  const lineage = {};
  function publish() {
    published = state;
    for (const listener of listeners) {
      listener();
    }
  }
  function patch(changes: FolderChange[], shows: (parentId: string) => boolean) {
    const entries = patchEntries(state.entries, changes, shows);
    if (entries) {
      state = { ...state, entries };
    }
  }
  function close() {
    if (closed) {
      return;
    }
    closed = true;
    api.cancelScan(scanId).catch(() => {
      /* The session may already be closed. */
    });
  }
  if (signal.aborted) {
    close();
    signal.throwIfAborted();
  }

  // Received batches always land in `state`, even when the request that asked for them was
  // aborted, so a retried request continues where the scan is rather than skipping entries.
  async function pull(requestSignal: AbortSignal) {
    if (!state.loading) {
      return state;
    }
    requestSignal.throwIfAborted();
    if (closed) {
      throw new DOMException('Scan cancelled', 'AbortError');
    }
    const firstPage = state.entries.length === 0;
    const entries = [...state.entries],
      errors = [...state.errors];
    extendsLineage(entries, lineage);
    const deadline = performance.now() + (firstPage ? FIRST_PAGE_MS : LATER_PAGE_MS);
    const keepPulling = () =>
      state.loading && !closed && !requestSignal.aborted && performance.now() < deadline;
    try {
      do {
        const batch = await api.nextBatch(scanId);
        entries.push(...batch.entries);
        errors.push(...batch.errors);
        state = { entries, error: null, errors, loading: !batch.done };
      } while (keepPulling());
    } catch (error) {
      if (closed) {
        throw new DOMException(`Scan cancelled: ${String(error)}`, 'AbortError');
      }
      state = { ...state, error: String(error), loading: false };
    }
    if (!state.loading) {
      close();
      for (const changes of waiting.splice(0)) {
        patch(...changes);
      }
    }
    publish();
    requestSignal.throwIfAborted();
    return state;
  }

  // One pull at a time: a superseded request may still be waiting on its batch.
  let pulling: Promise<unknown> = Promise.resolve();
  function next(requestSignal: AbortSignal) {
    const result = pulling.then(() => pull(requestSignal));
    pulling = result.catch(() => null);
    return result;
  }

  let streaming = false;
  async function stream() {
    if (streaming) {
      return;
    }
    streaming = true;
    const always = new AbortController().signal;
    try {
      while (published.loading) {
        await next(always);
      }
    } catch {
      // Closed: the view that wanted these entries has already moved on.
    }
  }

  return {
    apply(changes, shows) {
      if (state.loading) {
        waiting.push([changes, shows]);
        return;
      }
      patch(changes, shows);
      publish();
    },
    close,
    getSnapshot: () => published,
    next,
    stream: () => {
      stream().catch(() => null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Reads a scan to the end. */
export async function readAll(api: PhotosAPI, options: ScanOptions) {
  const always = new AbortController().signal;
  const scan = await openScan(api, options, always);
  let state = await scan.next(always);
  while (state.loading) {
    state = await scan.next(always);
  }
  return state;
}

const subfolderLists = new WeakMap<ScanState, PhotoEntry[]>();
/** The folders a scan found, by name, kept per scan so each state sorts them once. */
export function subfolders(state: ScanState | undefined) {
  if (!state) {
    return [];
  }
  let list = subfolderLists.get(state);
  if (!list) {
    const directories = state.entries.filter((entry) => entry.kind === 'directory');
    list = arrangeEntries(directories, '', 'name', false);
    subfolderLists.set(state, list);
  }
  return list;
}
