import { isNotFoundOrNotAFolder, isOfflineError } from '#photos/worker/disk/fs-errors';
import { ShareOfflineError } from '#photos/worker/disk/share/share-offline-error';
import { JoinableRun, Listeners } from '@prism/shared';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Whether the library's folder can be reached:
 * - `online`: it can.
 * - `offline`: its volume, such as a network share, is not mounted or does not answer.
 * - `gone`: its volume is there but the folder is not, because it was moved, renamed or deleted.
 */
export type ShareState = 'online' | 'offline' | 'gone';

/** Looks at the disk to find the library folder's state now. */
export type ShareCheck = () => Promise<ShareState>;

/** What a `stat` of a path found: the device it is on, or the error it failed with. */
export type StatResult = { kind: 'found'; dev: number } | { kind: 'failed'; error: unknown };

/** Where each system mounts volumes other than its own disk; see `mountPointOf`. */
const MOUNT_POINTS: Partial<Record<NodeJS.Platform, RegExp>> = {
  darwin: /^\/Volumes\/[^/]+/u,
  linux: /^\/(?:mnt\/[^/]+|media\/[^/]+\/[^/]+|run\/media\/[^/]+\/[^/]+)/u,
  win32: /^(?:\\\\[^\\]+\\[^\\]+|[a-z]:)/iu,
};

/** How often the folder is checked while `Share.watch` runs. */
const CHECK_MS = 3000;

/** A share that is mounted but not answering can take a minute to fail a check; past this, it is offline. */
const CHECK_TIMEOUT_MS = 5000;

/**
 * Where the volume holding `root`, a canonical path, is mounted, or `null` for a folder on the
 * system's own disk. macOS mounts shares and disks in `/Volumes`, Linux in `/media`,
 * `/run/media` or `/mnt`, and on Windows a share's or drive's root is part of the path. Nothing
 * says where a volume that is not mounted would be, so this goes by those places alone.
 */
export function mountPointOf(root: string, platform = process.platform): string | null {
  return MOUNT_POINTS[platform]?.exec(root)?.[0] ?? null;
}

/**
 * Works out the library folder's state from a `stat` of the folder, and, if it is on a volume
 * of its own, a `stat` of the volume's mount point and of the folder holding that point.
 *
 * - The volume is offline if its mount point is missing, or is on the same device as the folder
 *   holding it: that is the empty folder an unmounted volume leaves behind. Windows has no
 *   folder holding its drives and shares, so there is no `parent` there.
 * - The volume is also offline if the folder's `stat` fails with an error that says the volume
 *   does not answer.
 * - The folder is gone if its `stat` says nothing is there.
 * - Any other failure, such as a folder the app may not read, counts as online: the read that
 *   meets it reports it.
 */
export function shareStateFrom(
  root: StatResult,
  volume?: { point: StatResult; parent?: StatResult },
): ShareState {
  if (volume) {
    const { point, parent } = volume;
    const isLeftBehind =
      point.kind === 'found' && parent?.kind === 'found' && parent.dev === point.dev;
    if (point.kind === 'failed' || isLeftBehind) {
      return 'offline';
    }
  }
  switch (root.kind) {
    case 'found': {
      return 'online';
    }
    default: {
      if (isOfflineError(root.error)) {
        return 'offline';
      }
      return isNotFoundOrNotAFolder(root.error) ? 'gone' : 'online';
    }
  }
}

/** A `stat` of `file`, which never rejects. */
async function statDevice(file: string): Promise<StatResult> {
  try {
    return { dev: (await stat(file)).dev, kind: 'found' };
  } catch (error) {
    return { error, kind: 'failed' };
  }
}

/**
 * Creates the check of `root`'s state, on the volume mounted at `mountPoint` if any; see
 * `shareStateFrom`. A check that hangs, as on a share mounted but not answering, counts as
 * offline after `CHECK_TIMEOUT_MS`. No other check starts until it settles, because each one
 * holds one of libuv's threads until the system gives up on it, and the thumbnail reads need
 * those threads too.
 */
export function createShareCheck(root: string, mountPoint = mountPointOf(root)): ShareCheck {
  const holder = mountPoint && process.platform !== 'win32' ? path.dirname(mountPoint) : null;
  const check = new JoinableRun(async () => {
    const [rootStat, point, parent] = await Promise.all([
      statDevice(root),
      mountPoint ? statDevice(mountPoint) : undefined,
      holder ? statDevice(holder) : undefined,
    ]);
    return shareStateFrom(rootStat, point && { parent, point });
  });
  return () =>
    Promise.race([check.run(), delay(CHECK_TIMEOUT_MS, 'offline' as const, { ref: false })]);
}

/**
 * Returns the `failures` to read photos that are the files' own fault, which the catalog may
 * record as unreadable. If a check finds the library's folder is not online, none are: a share
 * offline or a library moved away is not the photos' fault. Failures with an error a share
 * gives when it goes offline are left out too.
 */
export async function filesOwnFailures<Failure extends { error: unknown }>(
  share: Share,
  failures: Failure[],
): Promise<Failure[]> {
  if (failures.length === 0 || (await share.check()) !== 'online') {
    return [];
  }
  return failures.filter(({ error }) => !isOfflineError(error));
}

/**
 * The library folder's state as of the last check, made with `checkShare`. It counts as online
 * until a check finds otherwise. It is checked every `CHECK_MS` while `watch` runs, and whenever
 * work fails in a way that may mean the share went offline (`failedOffline`). Listeners are called
 * with each change.
 */
export class Share {
  #state: ShareState = 'online';
  readonly #check = new JoinableRun(() => this.#checkAndTell());
  readonly #listeners = new Listeners<ShareState>();

  constructor(private readonly checkShare: ShareCheck) {}

  get state(): ShareState {
    return this.#state;
  }

  /**
   * Throws a `ShareOfflineError` if the last check found the folder's volume offline, before a
   * look at the disk. A share that is mounted but not answering takes about a minute to fail
   * each look, so the look is not tried.
   */
  throwIfOffline(): void {
    if (this.#state === 'offline') {
      throw new ShareOfflineError();
    }
  }

  /** Checks again, or joins the check under way. */
  check(): Promise<ShareState> {
    return this.#check.run();
  }

  async #checkAndTell(): Promise<ShareState> {
    const state = await this.checkShare();
    const changed = state !== this.#state;
    this.#state = state;
    if (changed) {
      this.#listeners.tell(state);
    }
    return state;
  }

  /**
   * Whether the folder's volume is there now. The check starts after this is called, so it
   * comes after whatever the caller found: a folder that seems gone, or a listing that seems
   * short, may only mean the volume went away.
   */
  async isVolumeThere(): Promise<boolean> {
    await this.#check.underWay;
    return (await this.check()) !== 'offline';
  }

  /**
   * Whether `error` came from the folder's volume going offline. That is so for an error that
   * says the volume does not answer, or that nothing is there, once a check finds the volume
   * offline. Any other error belongs to the work itself.
   */
  async failedOffline(error: unknown): Promise<boolean> {
    if (error instanceof ShareOfflineError) {
      return true;
    }
    if (!isOfflineError(error) && !isNotFoundOrNotAFolder(error)) {
      return false;
    }
    return (await this.check()) === 'offline';
  }

  /** Calls `listener` with each change of the folder's state. */
  onChange(listener: (state: ShareState) => void): () => void {
    return this.#listeners.add(listener);
  }

  /**
   * Checks now, and then every `CHECK_MS`, until `signal` aborts. A share that goes offline
   * while nothing reads it, or comes back, is then noticed within seconds, and each check is
   * only a few `stat` calls. Nothing tells the app when a volume mounts or unmounts, or when a
   * share stops answering.
   */
  async watch(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.check();
      await delay(CHECK_MS, undefined, { signal }).catch(() => null);
    }
  }
}
