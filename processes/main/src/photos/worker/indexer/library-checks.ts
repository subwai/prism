import type { IndexOptions } from '#photos/worker/indexer/index-run';
import type { Indexer } from '#photos/worker/indexer/indexer';
import type { Catalog, FullReads } from '@prism/catalog';
import { type FolderCheck, JoinableRun, Listeners } from '@prism/shared';

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
 * Which full read a launch's check makes:
 * - `none`, because the last one got to the end within the last week;
 * - `resume` the one the library closed during, from when it started, unless that was over a
 *   week ago;
 * - otherwise a `new` one.
 */
export type FullReadDue =
  | { kind: 'none' }
  | { kind: 'resume'; startedMs: number }
  | { kind: 'new' };

/** Which full read a launch's check at `now` makes, from the library's `FullReads`. */
export function fullReadDue({ lastMs, startedMs }: FullReads, now: number): FullReadDue {
  if (lastMs !== null && now - lastMs <= FULL_READ_EVERY_MS) {
    return { kind: 'none' };
  }
  return startedMs !== null && now - startedMs <= FULL_READ_EVERY_MS
    ? { kind: 'resume', startedMs }
    : { kind: 'new' };
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
 * The library's passes over every folder: each launch's check, and full reads. Both read in the
 * background, share their reads with the views' reads, and stop when the library closes.
 * `lastCheck` says how the last of either ended, and `onChange` listeners are called when that
 * changes.
 */
export function libraryChecks({ catalog, indexer, now, signal }: CheckSources) {
  /** The full read under way, and whether it was taken up again from an earlier launch. */
  let fullRead: { done: Promise<void>; resumed: boolean } | undefined;
  /** The check of every folder. Another check asked for while one is under way joins it. */
  const everyFolderCheck = new JoinableRun(check);
  let lastCheck: FolderCheck | null = null;
  const listeners = new Listeners();

  /**
   * Looks at every folder as `options` say, records how it ended in `lastCheck`, and settles with
   * whether it looked at every one.
   */
  async function lookAtEveryFolder(options?: IndexOptions): Promise<boolean> {
    const run = indexer.index(EVERY_FOLDER, signal, options);
    await run.done;
    const complete = !signal.aborted && run.error === null;
    lastCheck = { ...run.walk, complete, endedMs: now() };
    listeners.tell();
    return complete;
  }

  /**
   * Reads every folder in full, including those read this session.
   * - A read taken up again from `resumedFrom` skips the folders the catalog says were read since
   *   then, wherever they were read.
   * - Its start is recorded before any folder is read. If the library closes during the read, the
   *   next launch takes it up again from there, however far it got.
   * - A read that gets to the end, its own folder included, is recorded as finished instead.
   */
  async function readInFull(resumedFrom?: number) {
    indexer.forget();
    await catalog.committed(catalog.write({ at: resumedFrom ?? now(), kind: 'startFullRead' }));
    if (await lookAtEveryFolder({ fullRead: true, readSince: resumedFrom })) {
      await catalog.committed(catalog.write({ at: now(), kind: 'finishFullRead' }));
    }
  }

  /**
   * Starts a full read once `before` settles, and makes it the one under way. It is taken up
   * again from `resumedFrom` if given, and is a new one otherwise.
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
   * Reads every folder of the library again in full, including those read this session, for
   * what a folder's times miss; see `FolderTimes`.
   * - While a full read this session began is under way, it settles with that one instead of
   *   starting another.
   * - A read taken up again from an earlier launch skips folders read before this launch, which
   *   may hold what the user asked for, so a new read follows it.
   */
  function readEveryFolder(): Promise<void> {
    if (fullRead && !fullRead.resumed) {
      return fullRead.done;
    }
    return startFullRead(undefined, fullRead?.done);
  }

  /**
   * Looks at every folder the catalog knows, and those found inside them, so the catalog catches
   * up with what changed while the library was closed or its share offline, removed folders
   * included. Settles once every folder has been looked at.
   * - A folder is read only if it changed since the catalog last read it (see `FolderTimes`).
   * - About once a week every folder is read, as `readEveryFolder` does, taking up the last full
   *   read if it did not get to the end.
   * - A check asked for while one is under way joins it.
   */
  function checkEveryFolder(): Promise<unknown> {
    return everyFolderCheck.run();
  }

  async function check(): Promise<unknown> {
    const due = fullReadDue(await catalog.call('fullReads'), now());
    // A full read already asked for reads every folder anyway.
    if (fullRead) {
      return fullRead.done;
    }
    switch (due.kind) {
      case 'none': {
        return lookAtEveryFolder();
      }
      case 'resume': {
        return startFullRead(due.startedMs);
      }
      default: {
        return startFullRead();
      }
    }
  }

  return {
    checkEveryFolder,
    lastCheck: () => lastCheck,
    onChange(listener: () => void): () => void {
      return listeners.add(listener);
    },
    readEveryFolder,
  };
}

export type LibraryChecks = ReturnType<typeof libraryChecks>;
