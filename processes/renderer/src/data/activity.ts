import { type DetailsSample, msLeft, timeLeft, withSample } from '#data/details-estimate';
import type { StatusDetail } from '@prism/design-system';
import {
  type Activity,
  type DetailsProgress,
  type FolderCheck,
  IDLE_ACTIVITY,
  type Jobs,
  type WalkProgress,
} from '@prism/shared';
import { useSyncExternalStore } from 'react';

/** What a row says of work that is not under way. */
const IDLE = 'Idle';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function counted(count: number, what: string) {
  return count > 0 ? [`${count.toLocaleString()} ${what}`] : [];
}

/**
 * The row of `label`, saying what is counted, or that it is idle if nothing is. Every row is
 * always there, in the same place, so one can be followed as the counts change.
 */
function row(label: string, counts: string[]): StatusDetail {
  return counts.length > 0
    ? { active: true, label, value: counts.join(' · ') }
    : { active: false, label, value: IDLE };
}

function jobs(label: string, { running, waiting }: Jobs) {
  return row(label, [...counted(running, 'running'), ...counted(waiting, 'waiting')]);
}

/** How long before `now` the time `ms` was, rounded down so that it changes seldom. */
function ago(ms: number, now: number) {
  const since = now - ms;
  if (since < MINUTE_MS) {
    return 'just now';
  }
  if (since < HOUR_MS) {
    return `${Math.floor(since / MINUTE_MS)} min ago`;
  }
  if (since < 48 * HOUR_MS) {
    return `${Math.floor(since / HOUR_MS)} h ago`;
  }
  return `${Math.floor(since / (24 * HOUR_MS))} days ago`;
}

/** How far a walk got through the folders it found, from 0 to 1. */
function share({ found, looked }: WalkProgress) {
  return found > 0 ? looked / found : 0;
}

/**
 * How up to date the folders are as of the last look at every folder, at `now`: checked, or
 * stopped part-way, with its bar as far as it got, or not yet looked at this session.
 */
function checked(check: FolderCheck | null, now: number): Omit<StatusDetail, 'label'> {
  if (!check) {
    return { active: false, progress: 0, value: 'Not checked yet' };
  }
  if (check.complete) {
    return { active: false, progress: 1, value: `Up to date · checked ${ago(check.endedMs, now)}` };
  }
  const percent = Math.floor(share(check) * 100);
  return {
    active: false,
    progress: share(check),
    value: check.full
      ? `Full read paused · ${percent}% read`
      : `Check stopped · ${percent}% checked`,
  };
}

/**
 * The walk under way, and how far it has got; or else, while the share is offline, that it is;
 * or the folders read without a walk, as a walk's reads are its own; or how up to date the last
 * look at every folder left them, at `now`. It always has a progress bar, so it keeps its height.
 */
function folders({ lastCheck, offline, walk }: Activity, lane: Jobs, now: number): StatusDetail {
  const label = 'Folders';
  if (walk) {
    const how = walk.full ? 'Reading all' : 'Checking';
    const counts = `${walk.looked.toLocaleString()} of ${walk.found.toLocaleString()}`;
    // A walk waits while the share is offline, rather than failing.
    return {
      active: !offline,
      label,
      progress: share(walk),
      value: `${offline ? 'Share offline' : how} · ${counts}`,
    };
  }
  const last = checked(lastCheck, now);
  if (offline) {
    return { ...last, label, value: 'Share offline' };
  }
  if (lane.running + lane.waiting > 0) {
    return { ...jobs(label, lane), progress: last.progress };
  }
  return { ...last, label };
}

/**
 * How many of the library's photos have their details read, of how many, with those whose
 * details could not be read, which count as read, and the time left at the rate they are read
 * now, `left` ms, while they are; or the jobs that read them, until the catalog has counted.
 * Like the folders' row, it always has a bar. The jobs' counts are left out once it has counted,
 * as they are of the photos picked to read next, not of those left.
 */
function photoDetails(details: DetailsProgress | null, lane: Jobs, left: number | null) {
  if (!details) {
    return { ...jobs('Photo details', lane), progress: 0 };
  }
  const { photos, read, unreadable } = details;
  const progress = photos > 0 ? read / photos : 0;
  const unreadableCount = counted(unreadable, 'unreadable');
  if (read >= photos) {
    return {
      active: false,
      label: 'Photo details',
      progress,
      value: ['All read', ...unreadableCount].join(' · '),
    };
  }
  const reading = lane.running + lane.waiting > 0;
  const counts = `${read.toLocaleString()} of ${photos.toLocaleString()}`;
  const time = reading && left !== null ? [timeLeft(left)] : [];
  return {
    active: reading,
    label: 'Photo details',
    progress,
    value: [counts, ...unreadableCount, ...time].join(' · '),
  };
}

/**
 * Every kind of work, a row each in a fixed order, with what of it is under way; `detailsLeft`
 * is how long reading the remaining photos' details takes, if known, and `now` the time, which
 * the folders' row says how long ago they were checked by.
 */
export function activityDetails(
  activity: Activity,
  detailsLeft: number | null,
  now: number,
): StatusDetail[] {
  const { details, jobs: lanes, saving, skeleton, views } = activity;
  const { decode, thumbnail } = lanes;
  // A thumbnail's job holds its read's turn until its photo is decoded, in a job of its own.
  const reading = Math.max(0, thumbnail.running - decode.running - decode.waiting);
  return [
    folders(activity, lanes.folder, now),
    row('Thumbnails', [
      ...counted(reading, 'reading'),
      ...counted(decode.running, 'decoding'),
      ...counted(thumbnail.waiting + decode.waiting, 'waiting'),
    ]),
    photoDetails(details, lanes.details, detailsLeft),
    jobs('Folder covers', lanes.tile),
    jobs('Conversions', lanes.conversion),
    row('Catalog writes', counted(saving, saving === 1 ? 'entry' : 'entries')),
    row('View order', views ? ['Sorting'] : []),
    row('Folder tree', skeleton ? ['Rebuilding'] : []),
  ];
}

/** What the rows say before the worker has said anything. */
export const NOTHING_HEARD: StatusDetail[] = activityDetails(IDLE_ACTIVITY, null, 0);

/** What the worker said it is busy with, and how long reading photos' details has left. */
export interface Heard {
  activity: Activity;
  detailsLeft: number | null;
}

/** What the open folder's worker last said it is busy with; `null` until it says. */
let heard: Heard | null = null;
/** How many photos had their details read as the worker said lately, for the rate. */
let samples: DetailsSample[] = [];
const listeners = new Set<() => void>();
let stopHearing: (() => void) | undefined;

function hear(activity: Activity) {
  const { details } = activity;
  if (details) {
    samples = withSample(samples, { ms: Date.now(), read: details.read });
  }
  heard = { activity, detailsLeft: details && msLeft(samples, details.photos - details.read) };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  if (!stopHearing) {
    // What was heard before may be of another folder; the worker's bridge says it again.
    heard = null;
    samples = [];
    stopHearing = globalThis.app.photos.onActivity(hear);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopHearing?.();
      stopHearing = undefined;
    }
  };
}

/**
 * Whether the share the open folder is on is offline, as its worker last said, while which
 * everything shown comes from the catalog. It changes rarely, so what reads it renders again only
 * then, not as the work under way does.
 */
export function useShareOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => heard?.activity.offline ?? false,
    () => false,
  );
}

/**
 * What the open folder's worker is busy with, as it last said, and how long reading photos'
 * details has left at the rate it said they were read lately. Only the status bar's indicator
 * reads it, so nothing else renders again as it changes. The build prerenders without it.
 */
export function useActivity(): Heard | null {
  return useSyncExternalStore(
    subscribe,
    () => heard,
    () => null,
  );
}

/** Hears once a minute. */
function everyMinute(listener: () => void) {
  const timer = setInterval(listener, MINUTE_MS);
  return () => clearInterval(timer);
}

/**
 * The time now, to the minute, which moves on once a minute, so that how long ago the folders
 * were checked stays true while the worker, which sends only what changes, says nothing new. The
 * build prerenders at 0.
 */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    everyMinute,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => 0,
  );
}
