import { isMissing } from '#photos/worker/folder-reads';
import { ShareOfflineError } from '#photos/worker/share-offline-error';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Whether the library's folder can be reached: `online`; `offline`, as its volume, such as a
 * network share, is not mounted or does not answer; or `gone`, as its volume is there but the
 * folder is not, having been moved, renamed or deleted.
 */
export type Reach = 'online' | 'offline' | 'gone';

/** Finds how the library's folder can be reached now. */
export type Probe = () => Promise<Reach>;

/** What a look at a path found: its device, or why it could not be looked at. */
export type Look = { dev: number } | { error: unknown };

/** Errors that say the volume does not answer, rather than that nothing is at the path. */
const OFFLINE_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'EIO',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTCONN',
  'ENXIO',
  'ESTALE',
  'ETIMEDOUT',
]);

/** Where each system mounts volumes other than its own disk; see `mountPointOf`. */
const MOUNT_POINTS: Partial<Record<NodeJS.Platform, RegExp>> = {
  darwin: /^\/Volumes\/[^/]+/u,
  linux: /^\/(?:mnt\/[^/]+|media\/[^/]+\/[^/]+|run\/media\/[^/]+\/[^/]+)/u,
  win32: /^(?:\\\\[^\\]+\\[^\\]+|[a-z]:)/iu,
};

/** How often the folder is looked at while `Share.watch` runs. */
const CHECK_MS = 3000;

/** A share that is mounted but unreachable can take a minute to fail a look; past this, it is offline. */
const LOOK_MS = 5000;

/** Whether `error` says the volume a path is on does not answer. */
export function isOfflineError(error: unknown): boolean {
  return OFFLINE_CODES.has((error as NodeJS.ErrnoException | undefined)?.code ?? '');
}

/**
 * Where the volume holding `root`, a canonical path, is mounted, if it is on one other than
 * the system's: macOS mounts shares and disks in `/Volumes`, Linux in `/media`, `/run/media`
 * or `/mnt`, and Windows names a share's or drive's root in the path. Nothing says where a
 * volume that is not mounted would be, so this goes by those places alone; `null` for a
 * folder on the system's own disk.
 */
export function mountPointOf(root: string, platform = process.platform): string | null {
  return MOUNT_POINTS[platform]?.exec(root)?.[0] ?? null;
}

/**
 * How the library's folder can be reached, from a look at it and, if it is on a volume of its
 * own, at the volume's mount point and, but on Windows, whose drives and shares are held by
 * no folder, the folder holding that. A mount point that is not
 * there, or is a folder on the same device as the one holding it, as an unmounted volume
 * leaves behind, is offline, as is a look that says the volume does not answer. Anything else
 * that fails, such as a folder the app may not read, is a matter for the read that meets it.
 */
export function reachFrom(root: Look, volume?: { point: Look; parent?: Look }): Reach {
  if (volume) {
    const { point, parent } = volume;
    if ('error' in point || (parent && 'dev' in parent && parent.dev === point.dev)) {
      return 'offline';
    }
  }
  if ('dev' in root) {
    return 'online';
  }
  if (isOfflineError(root.error)) {
    return 'offline';
  }
  return isMissing(root.error) ? 'gone' : 'online';
}

/** A look at `file`, as `Look`, settling once it does. */
async function look(file: string): Promise<Look> {
  try {
    return { dev: (await stat(file)).dev };
  } catch (error) {
    return { error };
  }
}

/**
 * Finds how `root` can be reached now, as `reachFrom` says, on the volume mounted at
 * `mountPoint`, if any. A look that hangs, as on a share mounted but unreachable, is offline
 * after `LOOK_MS`, and no other look starts until it settles: each holds one of libuv's
 * threads until the system gives up on it, which those that find thumbnails share.
 */
export function probeOf(root: string, mountPoint = mountPointOf(root)): Probe {
  const holder = mountPoint && process.platform !== 'win32' ? path.dirname(mountPoint) : null;
  let looking: Promise<Reach> | undefined;
  return () => {
    looking ??= (async () => {
      const [rootLook, point, parent] = await Promise.all([
        look(root),
        mountPoint ? look(mountPoint) : undefined,
        holder ? look(holder) : undefined,
      ]);
      return reachFrom(rootLook, point && { parent, point });
    })().finally(() => {
      looking = undefined;
    });
    return Promise.race([looking, delay(LOOK_MS, 'offline' as const, { ref: false })]);
  };
}

/**
 * Of `failures` to read photos of the library, those that are the files' own, which the catalog
 * may keep as unreadable: none unless a look finds the library's folder there, as a share
 * offline or a library moved away is no fault of its photos, and none that failed as a share
 * does when it goes.
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
 * How the library's folder could be reached when last looked at, through `probe`. It is taken
 * as online until a look finds otherwise. It is looked at every `CHECK_MS` while `watch` runs,
 * and whenever work fails as if it went offline (`lost`), and tells its listeners each change.
 */
export class Share {
  #reach: Reach = 'online';
  #checking: Promise<Reach> | undefined;
  readonly #listeners = new Set<(reach: Reach) => void>();

  constructor(private readonly probe: Probe) {}

  get reach(): Reach {
    return this.#reach;
  }

  /** Looks again, or joins the look under way. */
  check(): Promise<Reach> {
    this.#checking ??= this.probe()
      .then((reach) => {
        const changed = reach !== this.#reach;
        this.#reach = reach;
        for (const listener of changed ? this.#listeners : []) {
          listener(reach);
        }
        return reach;
      })
      .finally(() => {
        this.#checking = undefined;
      });
    return this.#checking;
  }

  /**
   * Whether the folder's volume is there now, by a look that begins after this is asked, so it
   * comes after whatever the caller found: a folder that seems gone, or a listing that seems
   * short, may only say the volume went.
   */
  async confirm(): Promise<boolean> {
    await this.#checking;
    return (await this.check()) !== 'offline';
  }

  /**
   * Whether `error` came of the folder's volume going offline: one that says it does not answer,
   * or that nothing is there, once a look finds it offline. Anything else is the work's own.
   */
  async lost(error: unknown): Promise<boolean> {
    if (error instanceof ShareOfflineError) {
      return true;
    }
    if (!isOfflineError(error) && !isMissing(error)) {
      return false;
    }
    return (await this.check()) === 'offline';
  }

  /** Hears of each change in how the folder can be reached. */
  onChange(listener: (reach: Reach) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Looks now, and then every `CHECK_MS`, until `signal` aborts, so a share that goes offline
   * while nothing reads it, or comes back, is seen within seconds: each look is a `stat` or three.
   * Nothing tells of a volume mounting or unmounting, nor of a share that stops answering.
   */
  async watch(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.check();
      await delay(CHECK_MS, undefined, { signal }).catch(() => null);
    }
  }
}
