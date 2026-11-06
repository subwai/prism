import { type DirectoryScan, openScan, readAll } from '#data/directory-scan';
import { lists } from '#data/folder-changes';
import type { FolderChange, PhotoEntry, PhotosAPI, ScanOptions } from '@prism/shared';

// Enough to go back and forth between a few folders, and between grid and filmstrip.
const KEPT_GALLERIES = 4;

interface Gallery {
  scan: DirectoryScan;
  options: ScanOptions;
}

/** Views whose scans would list the same entries share this. */
function galleryKey({ directoryId, recursive, metadata, excludeDirectoryIds }: ScanOptions) {
  return JSON.stringify([
    directoryId,
    recursive ?? false,
    metadata ?? false,
    excludeDirectoryIds?.toSorted() ?? [],
  ]);
}

/**
 * The open view's scan, and the last few that read to the end, most recently opened last.
 * Changes on disk keep them all current, so going back to a kept one shows it at once instead
 * of reading the folder again.
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

  /** Opens the view's scan and reads its first page; later pages stream into the scan. */
  async show(options: ScanOptions, signal: AbortSignal) {
    // Closing a finished scan does nothing, so kept ones stay readable.
    this.open?.scan.close();
    const key = galleryKey(options);
    const kept = this.kept.get(key);
    if (kept) {
      this.keep(key, kept);
      this.open = kept;
      return kept.scan;
    }
    const scan = await openScan(this.api, options, signal);
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
    this.kept.clear();
  }
}
