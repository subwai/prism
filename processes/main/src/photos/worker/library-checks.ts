import type { Indexer } from '#photos/worker/indexer';
import type { Catalog, FullReads } from '@prism/catalog';

/**
 * How long each launch's check of a library reads only the folders that changed before it reads
 * every folder in full again, for what their times miss: folders whose times a tool set back,
 * and files rewritten in place. A full read that began longer ago than this is too old to take
 * up again.
 */
const FULL_READ_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** Every folder of the library, from its own folder down. */
const EVERY_FOLDER = { directoryId: '.', recursive: true };

/**
 * The full read a launch's check at `now` makes, as the library's `FullReads` say: `null` for
 * none, as the last got to the end in the last week; the one the library closed during, by
 * when it began, to take it up again, unless that was over a week ago; or a `new` one.
 */
export function fullReadDue({ lastMs, startedMs }: FullReads, now: number): number | 'new' | null {
  if (lastMs !== null && now - lastMs <= FULL_READ_EVERY_MS) {
    return null;
  }
  return startedMs !== null && now - startedMs <= FULL_READ_EVERY_MS ? startedMs : 'new';
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
  /** The full read under way, and whether it was taken up again from an earlier launch. */
  let fullRead: { done: Promise<void>; resumed: boolean } | undefined;

  /**
   * Reads every folder in full, those read this session included, but for one taken up again
   * from `resumedFrom`, which leaves those the catalog notes were read since then, wherever they
   * were read. When it began is noted before any folder is read, so a read the library closes
   * during is taken up again by the next launch from there, whatever it got to; one that gets
   * to the end, its own folder read, is noted in its place.
   */
  async function readInFull(resumedFrom?: number) {
    indexer.forget();
    await catalog.committed(catalog.write({ fullReadStarted: resumedFrom ?? now() }));
    const run = indexer.index(EVERY_FOLDER, signal, { full: true, readSince: resumedFrom });
    await run.done;
    if (!signal.aborted && run.error === null) {
      await catalog.committed(catalog.write({ fullRead: now() }));
    }
  }

  /**
   * Starts a full read once `before` settles, as the one under way: one taken up again from
   * `resumedFrom`, or a new one.
   */
  function startFullRead(resumedFrom?: number, before?: Promise<void>) {
    const done = (async () => {
      await before;
      await readInFull(resumedFrom);
    })().finally(() => {
      if (fullRead?.done === done) {
        fullRead = undefined;
      }
    });
    fullRead = { done, resumed: resumedFrom !== undefined };
    return done;
  }

  /**
   * Reads every folder of the library again in full, those read this session included, for
   * what a folder's times miss; see `FolderStamp`. While a full read this session began is under
   * way, it settles with that one rather than starting another. One taken up again from an
   * earlier launch leaves folders read before this one, which may hold what was asked for, so
   * a new one follows it.
   */
  function readEveryFolder(): Promise<void> {
    if (fullRead && !fullRead.resumed) {
      return fullRead.done;
    }
    return startFullRead(undefined, fullRead?.done);
  }

  /**
   * Looks at every folder the catalog knows, and those found inside them, so the catalog catches
   * up with what changed while the library was closed, folders gone included. A folder is read
   * only if it changed since the catalog last read it (see `FolderStamp`), but about once a week
   * every folder is, as `readEveryFolder` reads them, taking up the last that did not get to the
   * end. Settles once every folder is looked at.
   */
  async function checkEveryFolder(): Promise<unknown> {
    const due = fullReadDue(await catalog.call('fullReads'), now());
    // One asked for already reads every folder.
    if (fullRead) {
      return fullRead.done;
    }
    if (due === null) {
      return indexer.index(EVERY_FOLDER, signal).done;
    }
    return startFullRead(due === 'new' ? undefined : due);
  }

  return { checkEveryFolder, readEveryFolder };
}
