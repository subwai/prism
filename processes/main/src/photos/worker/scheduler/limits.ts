import { CONVERSION_CONCURRENCY, THUMBNAIL_CONCURRENCY, THUMBNAIL_READS } from '@prism/media';
import type { JobKind } from '@prism/shared';

/**
 * How much a piece of disk work matters now, highest first: what the window shows, what is just
 * ahead of its scroll, and what keeps the catalog true to the disk in the background.
 */
export const PRIORITIES = ['visible', 'ahead', 'background'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * How many jobs of each kind may run at once, by priority. A job starts only while two things
 * hold: fewer than its priority's limit run at its priority or lower, and fewer than the
 * `visible` limit run in all. Lower priorities get fewer slots, so work the window shows never
 * waits for a slot to free.
 */
export const LIMITS: Record<JobKind, Record<Priority, number>> = {
  conversion: {
    ahead: CONVERSION_CONCURRENCY,
    background: 0,
    visible: CONVERSION_CONCURRENCY,
  },
  // Thumbnails ahead of the scroll leave one decode for the next tile scrolled into view.
  decode: {
    ahead: Math.max(1, THUMBNAIL_CONCURRENCY - 1),
    background: 0,
    visible: THUMBNAIL_CONCURRENCY,
  },
  // Photos' details are read gently in the background, faster while Prism is the focused app
  // (`FOCUSED_LIMITS`), and at full speed while a view needs them.
  details: { ahead: 16, background: 4, visible: 16 },
  // A network share answers many folder reads at once about as fast as one. The background re-check
  // of every folder leaves a few slots for the folders the window asks for.
  folder: { ahead: 16, background: 12, visible: 16 },
  // Thumbnails ahead of the scroll leave half the reads to the tiles scrolled into view. None
  // are made in the background.
  thumbnail: { ahead: Math.floor(THUMBNAIL_READS / 2), background: 0, visible: THUMBNAIL_READS },
  // Reading a tile can open up to 256 folders, so only a few run at once.
  tile: { ahead: 4, background: 4, visible: 4 },
};

/**
 * The limits while a Prism window is focused: three times as many photos' details are read at
 * once in the background. At four at a time, a large library on a share takes a day of the app
 * being open. Once another app is in front, it goes back to four, leaving that app the share and
 * the CPU.
 */
export const FOCUSED_LIMITS: typeof LIMITS = {
  ...LIMITS,
  details: { ...LIMITS.details, background: 12 },
};

/**
 * Background jobs of a kind wait while foreground work of these kinds is waiting or running.
 * Photos' details are not read in the background while thumbnails or originals the window wants
 * are being made.
 */
const BACKGROUND_WAITS_FOR: Partial<Record<JobKind, JobKind[]>> = {
  details: ['thumbnail', 'conversion'],
};

/**
 * How many jobs of a kind may wait. The window asks for thumbnails and tiles as they come into
 * view, and for conversions as the viewer opens photos. The callers of the other kinds limit
 * themselves.
 */
export const MAX_WAITING: Partial<Record<JobKind, number>> = {
  conversion: 64,
  thumbnail: 256,
  tile: 256,
};

/** A job's kind and how much it matters now; `null` priority if nothing wants it any more. */
export interface PrioritizedJob {
  kind: JobKind;
  priority: Priority | null;
}

function rank(priority: Priority | null) {
  return priority === null ? PRIORITIES.length : PRIORITIES.indexOf(priority);
}

/** The kinds that have work above background priority waiting or running. */
function foregroundKinds(jobs: readonly PrioritizedJob[]) {
  const foreground = jobs.filter(({ priority }) => priority !== null && priority !== 'background');
  return new Set(foreground.map(({ kind }) => kind));
}

/** Whether a job must wait because it is background work and `busy` kinds have foreground work. */
function waitsForForeground(kind: JobKind, priority: Priority, busy: Set<JobKind>) {
  return (
    priority === 'background' && (BACKGROUND_WAITS_FOR[kind] ?? []).some((other) => busy.has(other))
  );
}

/** Whether a job of `kind` and `priority` fits beside the `running` jobs. */
function hasRoom(
  kind: JobKind,
  priority: Priority,
  running: readonly PrioritizedJob[],
  limits: typeof LIMITS,
) {
  const sameKind = running.filter((job) => job.kind === kind);
  const atOrBelow = sameKind.filter((job) => rank(job.priority ?? 'background') >= rank(priority));
  return sameKind.length < limits[kind].visible && atOrBelow.length < limits[kind][priority];
}

/** The indices of `waiting`, highest priority first, and oldest first within a priority. */
function indicesByPriority(waiting: readonly PrioritizedJob[]) {
  return waiting
    .map((_job, index) => index)
    .toSorted(
      (left, right) =>
        rank(waiting[left]?.priority ?? null) - rank(waiting[right]?.priority ?? null),
    );
}

/**
 * Returns the indices of the `waiting` jobs to start now beside the `running` ones. The most
 * wanted start first, and the oldest first within a priority, as far as `limits` allow.
 * - A waiting job nothing wants is never started.
 * - A running job nothing wants counts as background work.
 * - Running jobs over a limit, as after the limits were lowered, keep running, and no job of
 *   theirs starts until fewer run.
 */
export function jobsToStart(
  waiting: readonly PrioritizedJob[],
  running: readonly PrioritizedJob[],
  limits: typeof LIMITS = LIMITS,
): number[] {
  const busy = foregroundKinds([...waiting, ...running]);
  const now = [...running];
  const started: number[] = [];
  for (const index of indicesByPriority(waiting)) {
    const { kind, priority } = waiting[index] as PrioritizedJob;
    if (
      priority !== null &&
      !waitsForForeground(kind, priority, busy) &&
      hasRoom(kind, priority, now, limits)
    ) {
      now.push({ kind, priority });
      started.push(index);
    }
  }
  return started;
}
