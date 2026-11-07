import {
  type DirectoryScan,
  openScan,
  readAll,
  type ScanSeed,
  type ScanState,
} from '#data/directory-scan';
import { lists } from '#data/folder-changes';
import type { FolderChange, PhotoEntry, PhotosAPI, ScanOptions } from '@prism/shared';

// Enough to go back and forth between a few folders, and between grid and filmstrip.
const KEPT_GALLERIES = 4;

interface Gallery {
  scan: DirectoryScan;
  options: ScanOptions;
}

/**
 * Views whose scans would list the same entries share this. Sorts that need metadata share it
 * too: the scan reads metadata for what it has already listed instead of listing it again.
 */
function galleryKey({ directoryId, recursive, excludeDirectoryIds }: ScanOptions) {
  return JSON.stringify([directoryId, recursive ?? false, excludeDirectoryIds?.toSorted() ?? []]);
}

/** Whether a scan read everything it lists, so another view can start from its entries. */
function complete(state: ScanState) {
  return !state.loading && !state.error && state.errors.length === 0;
}

/**
 * The entries inside `folderId`, however deep, folders before their contents. A listing that
 * started from another's can name a folder after its contents, so this goes by parents.
 */
function inside(entries: PhotoEntry[], folderId: string) {
  const children = new Map<string, PhotoEntry[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId);
    if (siblings) {
      siblings.push(entry);
    } else {
      children.set(entry.parentId, [entry]);
    }
  }
  const found: PhotoEntry[] = [];
  const folders = [folderId];
  for (const folder of folders) {
    for (const entry of children.get(folder) ?? []) {
      found.push(entry);
      if (entry.kind === 'directory') {
        folders.push(entry.id);
      }
    }
  }
  return found;
}

/**
 * The open view's scan, and the last few that read to the end, most recently opened last.
 * Changes on disk keep them all current, so going back to a kept one shows it at once instead
 * of reading the folder again. A new view starts from what kept recursive scans list of it, so
 * opening a folder inside one, or one holding them, never lists those entries again.
 */
export class Galleries {
  open: Gallery | null = null;
  private readonly kept = new Map<string, Gallery>();

  constructor(
    private readonly api: PhotosAPI,
    private readonly rootId: string,
    private readonly folders: Map<string, PhotoEntry>,
    /** Told of what each scan has read so far. */
    private readonly found: (entries: PhotoEntry[]) => void,
  ) {}

  /**
   * Opens the view's scan and reads its first page; later pages stream into the scan. The open
   * scan, or a kept one, is shown again as it is, still reading if it was.
   */
  async show(options: ScanOptions, signal: AbortSignal) {
    const key = galleryKey(options);
    // A scan that failed is read again instead, as a refresh would.
    const shown =
      this.open && galleryKey(this.open.options) === key && !this.open.scan.getSnapshot().error
        ? this.open
        : undefined;
    const reused = shown ?? this.kept.get(key);
    if (!shown) {
      // Closing a finished scan only stops it reading metadata, so kept ones stay readable.
      this.open?.scan.close();
    }
    if (reused) {
      if (this.kept.has(key)) {
        this.keep(key, reused);
      }
      this.open = reused;
      if (options.metadata || options.exif) {
        reused.scan.wantMetadata(options.exif);
        await reused.scan.next(signal);
        reused.scan.stream();
      }
      return reused.scan;
    }
    const scan = await openScan(this.api, options, signal, this.seed(options));
    const gallery = { options, scan };
    this.open = gallery;
    this.found((await scan.next(signal)).entries);
    const keepFinished = () => {
      const state = scan.getSnapshot();
      if (!state.loading && !state.error && this.open === gallery) {
        this.keep(key, gallery);
      }
    };
    scan.subscribe(() => {
      this.found(scan.getSnapshot().entries);
      keepFinished();
    });
    keepFinished();
    scan.stream();
    return scan;
  }

  /** Whether `id` is `folderId` or a folder known to be inside it. */
  private holds(folderId: string, id: string) {
    if (folderId === this.rootId) {
      return true;
    }
    // However deep, the way up passes each known folder once at most.
    for (let current = id, depth = 0; depth <= this.folders.size; depth += 1) {
      if (current === folderId) {
        return true;
      }
      const folder = this.folders.get(current);
      if (!folder) {
        return false;
      }
      current = folder.parentId;
    }
    return false;
  }

  /**
   * What a new view can start from: everything it shows, if a kept recursive scan of a folder
   * holding it read to the end, or else, for a recursive view, the entries of kept recursive
   * scans of folders inside it, which the worker then leaves out.
   */
  private seed(options: ScanOptions): ScanSeed | undefined {
    const finished = [...this.kept.values()].filter(
      (gallery) =>
        gallery.options.recursive &&
        !gallery.options.excludeDirectoryIds?.length &&
        complete(gallery.scan.getSnapshot()),
    );
    const holding = finished.find((gallery) =>
      this.holds(gallery.options.directoryId, options.directoryId),
    );
    if (holding) {
      const { entries } = holding.scan.getSnapshot();
      return {
        complete: true,
        entries: options.recursive
          ? inside(entries, options.directoryId)
          : entries.filter((entry) => entry.parentId === options.directoryId),
        folders: [],
      };
    }
    if (!options.recursive) {
      return undefined;
    }
    const parts = finished.filter((gallery) =>
      this.holds(options.directoryId, gallery.options.directoryId),
    );
    // A kept scan inside another kept one lists nothing the outer one does not.
    const outermost = parts.filter(
      (gallery) =>
        !parts.some(
          (other) =>
            other !== gallery && this.holds(other.options.directoryId, gallery.options.directoryId),
        ),
    );
    if (outermost.length === 0) {
      return undefined;
    }
    return {
      complete: false,
      entries: outermost.flatMap((gallery) => gallery.scan.getSnapshot().entries),
      folders: outermost.map((gallery) => gallery.options.directoryId),
    };
  }

  private keep(key: string, gallery: Gallery) {
    this.kept.delete(key);
    this.kept.set(key, gallery);
    for (const oldest of this.kept.keys()) {
      if (this.kept.size <= KEPT_GALLERIES) {
        break;
      }
      this.kept.delete(oldest);
    }
  }

  /** Applies changes on disk to every scan; `known` says which folders are still there. */
  apply(changed: FolderChange[], known: (directoryId: string) => boolean) {
    for (const [key, { options }] of this.kept) {
      if (!known(options.directoryId)) {
        this.kept.delete(key);
      }
    }
    for (const gallery of new Set([this.open, ...this.kept.values()])) {
      if (gallery) {
        this.patch(gallery, changed);
      }
    }
  }

  private patch(gallery: Gallery, changed: FolderChange[]) {
    const within = (id: string) => lists(gallery.options, id, this.folders, this.rootId);
    gallery.scan.apply(changed, within);
    if (!gallery.options.recursive) {
      return;
    }
    // A folder moved into a recursive gallery brings its contents, which raise no events.
    for (const { entry, listingChanged } of changed) {
      if (listingChanged && entry?.kind === 'directory' && within(entry.parentId)) {
        readAll(this.api, { ...gallery.options, directoryId: entry.id })
          .then((state) => {
            this.found(state.entries);
            const added = state.entries.map((child) => ({
              contentChanged: false,
              entry: child,
              id: child.id,
              listingChanged: true,
              parentId: child.parentId,
            }));
            gallery.scan.apply(added, within);
          })
          .catch(() => null);
      }
    }
  }

  /** Closes the open scan and lets go of kept ones, so every view reads its folder again. */
  close() {
    this.open?.scan.close();
    this.open = null;
    this.kept.clear();
  }
}
