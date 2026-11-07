import { extendsLineage } from '#data/entries';
import { askFor, filled } from '#data/entry-details';
import { patchEntries } from '#data/folder-changes';
import {
  type FolderChange,
  MAX_METADATA_IDS,
  type PhotoEntry,
  type PhotoExif,
  type PhotoMetadata,
  type PhotosAPI,
  type ScanBatch,
  type ScanOptions,
} from '@prism/shared';

// The previous view stays on screen while the first page loads, so it can wait for most
// folders to finish; sorted results then appear once instead of reshuffling batch by batch.
// The same goes for the metadata a new sort asks for. Later pages of very large folders, and
// the rest of their metadata, arrive in chunks to limit re-sorting.
const FIRST_PAGE_MS = 400,
  LATER_PAGE_MS = 120;

export interface ScanState {
  entries: PhotoEntry[];
  errors: ScanBatch['errors'];
  loading: boolean;
  /** Reading the metadata or EXIF details a sort asked for, of entries listed without them. */
  sorting: boolean;
  error: string | null;
}

export interface DirectoryScan {
  next: (signal: AbortSignal) => Promise<ScanState>;
  /**
   * Reads the metadata of the entries listed without it, and of those still to come, as a sort
   * by date or size needs, and with `exif` photos' EXIF details too, as a sort by date taken
   * does, so changing the sort never reads the folder again. `next` and `stream` read it.
   */
  wantMetadata: (exif?: boolean) => void;
  /** Reads the remaining pages, and metadata, in the background until done or closed. */
  stream: () => void;
  /** `useSyncExternalStore` source: the state as of the last page read. */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ScanState;
  /**
   * Applies changes on disk, adding new entries wherever the scan `shows` their folder.
   * Changes during a scan wait for it to finish, since they are newer than it.
   */
  apply: (changes: FolderChange[], shows: (parentId: string) => boolean) => void;
  /** Cancels the scan if it is still reading, and stops reading metadata until wanted again. */
  close: () => void;
}

/**
 * What a scan starts from: entries another scan listed already, and the folders they are the
 * contents of, which the worker leaves out. When they are `complete`, nothing is read.
 */
export interface ScanSeed {
  entries: PhotoEntry[];
  folders: string[];
  complete: boolean;
}

/** The library owns this reader and closes it when another view or refresh replaces it. */
export async function openScan(
  api: PhotosAPI,
  options: ScanOptions,
  signal: AbortSignal,
  seed?: ScanSeed,
): Promise<DirectoryScan> {
  signal.throwIfAborted();
  const excluded = [...(options.excludeDirectoryIds ?? []), ...(seed?.folders ?? [])];
  const complete = seed?.complete ?? false;
  const scanId = complete
    ? undefined
    : await api.startScan(
        excluded.length > 0 ? { ...options, excludeDirectoryIds: excluded } : options,
      );
  let closed = complete;
  let state: ScanState = {
    entries: seed?.entries ?? [],
    error: null,
    errors: [],
    loading: !complete,
    sorting: false,
  };
  let published = state;
  const listeners = new Set<() => void>();
  const waiting: Parameters<DirectoryScan['apply']>[] = [];
  // Each page appends to the last, so views sort only what it adds. Metadata replaces entries
  // instead, so lists with it start a lineage of their own.
  let lineage = {};
  let wantsMetadata = (options.metadata ?? false) || (options.exif ?? false),
    wantsExif = options.exif ?? false,
    // Nobody shows this scan, so its metadata waits until it is wanted again.
    paused = false,
    // The entries before this one have metadata, or could not be read.
    checked = 0,
    // Wanting metadata for entries already listed waits as long as a first page does.
    firstFill = false,
    firstPage = true;
  const sorting = () => wantsMetadata && !paused && checked < state.entries.length;
  const needsExif = (entry: PhotoEntry) => wantsExif && entry.kind === 'image' && !entry.exif;
  function publish() {
    if (state.sorting !== sorting()) {
      state = { ...state, sorting: sorting() };
    }
    published = state;
    for (const listener of listeners) {
      listener();
    }
  }
  function patch(changes: FolderChange[], shows: (parentId: string) => boolean) {
    const entries = patchEntries(state.entries, changes, shows);
    if (entries) {
      state = { ...state, entries };
      // Changes carry their metadata, but they move entries about.
      checked = 0;
    }
  }
  function cancel() {
    if (closed || scanId === undefined) {
      return;
    }
    closed = true;
    api.cancelScan(scanId).catch(() => {
      /* The session may already be closed. */
    });
  }
  if (signal.aborted) {
    cancel();
    signal.throwIfAborted();
  }

  async function pullPages(id: string, inTime: () => boolean) {
    const keepPulling = () => !closed && inTime();
    const entries = [...state.entries],
      errors = [...state.errors];
    extendsLineage(entries, lineage);
    try {
      do {
        const batch = await api.nextBatch(id);
        entries.push(...batch.entries);
        errors.push(...batch.errors);
        state = { ...state, entries, error: null, errors, loading: !batch.done };
      } while (state.loading && keepPulling());
    } catch (error) {
      if (closed) {
        throw new DOMException(`Scan cancelled: ${String(error)}`, 'AbortError');
      }
      state = { ...state, error: String(error), loading: false };
    }
    if (!state.loading) {
      cancel();
      for (const changes of waiting.splice(0)) {
        patch(...changes);
      }
    }
  }

  /**
   * Reads metadata, and EXIF details if wanted, for at least one chunk of entries without them,
   * and more while there is time.
   */
  async function fill(keepFilling: () => boolean) {
    const metadata = new Map<string, PhotoMetadata>(),
      exif = new Map<string, PhotoExif>();
    try {
      do {
        const withoutMetadata = [],
          withoutExif = [];
        for (
          const end = Math.min(state.entries.length, checked + MAX_METADATA_IDS);
          checked < end;
          checked += 1
        ) {
          const entry = state.entries[checked];
          if (entry && !entry.metadata) {
            withoutMetadata.push(entry.id);
          }
          if (entry && needsExif(entry)) {
            withoutExif.push(entry.id);
          }
        }
        // Entries that are gone have none, and are not asked about again.
        await Promise.all([
          askFor((ids) => api.readMetadata(ids), withoutMetadata, metadata),
          askFor((ids) => api.readExif(ids), withoutExif, exif),
        ]);
      } while (sorting() && keepFilling());
    } catch {
      // The session closed; what was read still shows.
      paused = true;
    }
    if (metadata.size > 0 || exif.size > 0) {
      lineage = {};
      state = { ...state, entries: state.entries.map((entry) => filled(entry, metadata, exif)) };
    }
  }

  // Received batches always land in `state`, even when the request that asked for them was
  // aborted, so a retried request continues where the scan is rather than skipping entries.
  async function pull(requestSignal: AbortSignal) {
    if (!state.loading && !sorting()) {
      return state;
    }
    requestSignal.throwIfAborted();
    if (closed && state.loading) {
      throw new DOMException('Scan cancelled', 'AbortError');
    }
    const waitLonger = firstPage || firstFill;
    firstPage = false;
    firstFill = false;
    const deadline = performance.now() + (waitLonger ? FIRST_PAGE_MS : LATER_PAGE_MS);
    const inTime = () => !requestSignal.aborted && performance.now() < deadline;
    if (state.loading && scanId !== undefined) {
      await pullPages(scanId, inTime);
    }
    if (sorting()) {
      await fill(inTime);
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
      while (published.loading || published.sorting) {
        await next(always);
      }
    } catch {
      // Closed: the view that wanted these entries has already moved on.
    } finally {
      streaming = false;
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
    close() {
      cancel();
      paused = true;
    },
    getSnapshot: () => published,
    next,
    stream: () => {
      stream().catch(() => null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    wantMetadata(exif = false) {
      firstFill ||= !wantsMetadata || paused || (exif && !wantsExif);
      if (exif && !wantsExif) {
        // What was read so far has its metadata, but photos still need their EXIF details.
        wantsExif = true;
        checked = 0;
      }
      wantsMetadata = true;
      paused = false;
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
