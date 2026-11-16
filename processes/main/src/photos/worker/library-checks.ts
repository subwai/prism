import type { Indexer } from '#photos/worker/indexer';
import type { Catalog } from '@prism/catalog';

/**
 * How long each launch's check of a library reads only the folders that changed before it reads
 * every folder in full again, for what their times miss: folders whose times a tool set back,
 * and files rewritten in place.
 */
const FULL_READ_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** Every folder of the library, from its own folder down. */
const EVERY_FOLDER = { directoryId: '.', recursive: true };

/**
 * Whether a launch's check at `now` reads every folder in full, as the last full read of the
 * library got to the end at `lastMs`, or none has.
 */
export function isFullReadDue(lastMs: number | null, now: number): boolean {
  return lastMs === null || now - lastMs > FULL_READ_EVERY_MS;
}

interface CheckSources {
  catalog: Catalog;
  indexer: Indexer;
  /** The time now, which tests set. */
  now: () => number;
  /** Stops every read, as the library closes. */
  signal: AbortSignal;
}

/**
 * The library's looks at every folder: each launch's check, and full reads. Both read in the
 * background, share their reads with views', and stop as the library closes.
 */
export function libraryChecks({ catalog, indexer, now, signal }: CheckSources) {
  let fullRead: Promise<void> | undefined;

  async function readInFull() {
    indexer.forget();
    const run = indexer.index(EVERY_FOLDER, signal);
    await run.done;
    if (!signal.aborted && run.error === null) {
      await catalog.committed(catalog.write({ fullRead: now() }));
    }
  }

  /**
   * Reads every folder of the library again in full, those read this session included, for
   * what a folder's times miss; see `FolderStamp`. A read that gets to the end, its own folder
   * read, is noted in the catalog, which the next launches' checks go by. While one is under
   * way, another settles with it rather than starting.
   */
  function readEveryFolder(): Promise<void> {
    fullRead ??= readInFull().finally(() => {
      fullRead = undefined;
    });
    return fullRead;
  }

  /**
   * Looks at every folder the catalog knows, and those found inside them, so the catalog catches
   * up with what changed while the library was closed, folders gone included. A folder is read
   * only if it changed since the catalog last read it (see `FolderStamp`), but about once a week
   * every folder is, as `readEveryFolder` reads them. Settles once every folder is looked at.
   */
  async function checkEveryFolder(): Promise<unknown> {
    if (isFullReadDue(await catalog.call('fullReadMs'), now())) {
      return readEveryFolder();
    }
    return indexer.index(EVERY_FOLDER, signal, { onlyChanged: true }).done;
  }

  return { checkEveryFolder, readEveryFolder };
}
