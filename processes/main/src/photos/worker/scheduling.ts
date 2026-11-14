import { CONVERSION_CONCURRENCY, THUMBNAIL_CONCURRENCY } from '@prism/media';

/**
 * How much a piece of disk work matters now, highest first: what the window shows, what is just
 * ahead of its scroll, and what keeps the catalog true to the disk in the background.
 */
export const PRIORITIES = ['visible', 'ahead', 'background'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * The kinds of disk work, each with limits of its own, as each wears on something else: decodes
 * on the CPU, listings and reads on the disk or share.
 */
export type Lane = 'thumbnail' | 'conversion' | 'folder' | 'tile' | 'details';

/**
 * How many jobs of a lane may run at once, by priority: a job starts only while fewer than its
 * priority's limit run at its priority or lower, and fewer than the `visible` limit run in all.
 * Lower priorities fill fewer slots, so work the window shows never waits for one to free.
 */
export const LIMITS: Record<Lane, Record<Priority, number>> = {
  conversion: {
    ahead: CONVERSION_CONCURRENCY,
    background: 0,
    visible: CONVERSION_CONCURRENCY,
  },
  // Photos' details are read gently in the background, and at full speed while a view needs them.
  details: { ahead: 16, background: 4, visible: 16 },
  // A network share answers many listings at once about as fast as one; the re-check of every
  // folder leaves a few for the folders the window asks for.
  folder: { ahead: 16, background: 12, visible: 16 },
  // Thumbnails ahead of the scroll leave one decode for the next tile scrolled into view; none
  // is made in the background.
  thumbnail: {
    ahead: Math.max(1, THUMBNAIL_CONCURRENCY - 1),
    background: 0,
    visible: THUMBNAIL_CONCURRENCY,
  },
  // A tile's read opens up to 256 folders, so only a few run at once.
  tile: { ahead: 4, background: 4, visible: 4 },
};

/**
 * The lanes whose work a lane's background jobs make way for: photos' details are not read in
 * the background while thumbnails or originals the window wants are being made.
 */
const MAKES_WAY: Partial<Record<Lane, Lane[]>> = { details: ['thumbnail', 'conversion'] };

/**
 * How many jobs may wait in a lane. The window asks for thumbnails and tiles as they come into
 * view, and conversions as the viewer opens photos; the other lanes' callers bound themselves.
 */
export const CAPACITY: Partial<Record<Lane, number>> = {
  conversion: 64,
  thumbnail: 256,
  tile: 256,
};

/** A job as the scheduler weighs it: `null` priority if nothing wants it any more. */
export interface Weighed {
  lane: Lane;
  priority: Priority | null;
}

function rank(priority: Priority | null) {
  return priority === null ? PRIORITIES.length : PRIORITIES.indexOf(priority);
}

/** Lanes with work of a priority above background waiting or running. */
function foregroundLanes(jobs: readonly Weighed[]) {
  const foreground = jobs.filter(({ priority }) => priority !== null && priority !== 'background');
  return new Set(foreground.map(({ lane }) => lane));
}

/** Whether a background job of `lane` makes way for the work under way in the `busy` lanes. */
function makesWay(lane: Lane, priority: Priority, busy: Set<Lane>) {
  return priority === 'background' && (MAKES_WAY[lane] ?? []).some((other) => busy.has(other));
}

/** Whether a job of `priority` fits in `lane` beside the `running` jobs of every lane. */
function hasRoom(lane: Lane, priority: Priority, running: readonly Weighed[]) {
  const inLane = running.filter((job) => job.lane === lane);
  const atOrBelow = inLane.filter((job) => rank(job.priority ?? 'background') >= rank(priority));
  return inLane.length < LIMITS[lane].visible && atOrBelow.length < LIMITS[lane][priority];
}

/** The indices of `waiting` by priority, and of the same priority oldest first. */
function byPriority(waiting: readonly Weighed[]) {
  return waiting
    .map((_job, index) => index)
    .toSorted(
      (left, right) =>
        rank(waiting[left]?.priority ?? null) - rank(waiting[right]?.priority ?? null),
    );
}

/**
 * Which of `waiting`, in the order they came, start now beside `running`: the most wanted first,
 * and of the same priority the oldest, as far as each lane's limits allow. Jobs nothing wants are
 * never started; running jobs nothing wants count as background.
 */
export function startable(waiting: readonly Weighed[], running: readonly Weighed[]): number[] {
  const busy = foregroundLanes([...waiting, ...running]);
  const now = [...running];
  const started: number[] = [];
  for (const index of byPriority(waiting)) {
    const { lane, priority } = waiting[index] as Weighed;
    if (priority !== null && !makesWay(lane, priority, busy) && hasRoom(lane, priority, now)) {
      now.push({ lane, priority });
      started.push(index);
    }
  }
  return started;
}

/**
 * A view of fewer rows than this has thumbnails made for all of them, nearest to what is on show
 * first; in a larger one, only the rows on show have theirs made.
 */
export const AHEAD_ROWS = 1000;

/**
 * The rows of a view of `count` in the order to make their thumbnails: those on show, from
 * `start` up to `end`, then outward from them, the row after before the row before, as most
 * scrolling goes on down the view.
 */
export function nearestFirst(count: number, start: number, end: number): number[] {
  const first = Math.min(Math.max(0, start), count);
  const last = Math.min(Math.max(first, end), count);
  const order: number[] = [];
  for (let index = first; index < last; index += 1) {
    order.push(index);
  }
  for (let after = last, before = first - 1; after < count || before >= 0; after += 1) {
    if (after < count) {
      order.push(after);
    }
    if (before >= 0) {
      order.push(before);
      before -= 1;
    }
  }
  return order;
}
