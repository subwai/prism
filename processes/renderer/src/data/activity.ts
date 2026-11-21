import { type DetailsSample, msLeft, timeLeft, withSample } from '#data/details-estimate';
import type { StatusDetail } from '@prism/design-system';
import {
  type Activity,
  type DetailsProgress,
  IDLE_ACTIVITY,
  type Jobs,
  type WalkProgress,
} from '@prism/shared';
import { useSyncExternalStore } from 'react';

/** What a row says of work that is not under way. */
const IDLE = 'Idle';

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

/**
 * The walk under way, and how far it has got, or else the folders read without one, as a walk's
 * reads are its own. It always has a progress bar, empty but for a walk, so it keeps its height.
 */
function folders(walk: WalkProgress | null, lane: Jobs): StatusDetail {
  if (!walk) {
    return { ...jobs('Folders', lane), progress: 0 };
  }
  const how = walk.full ? 'Reading all' : 'Checking';
  return {
    active: true,
    label: 'Folders',
    progress: walk.found > 0 ? walk.looked / walk.found : 0,
    value: `${how} · ${walk.looked.toLocaleString()} of ${walk.found.toLocaleString()}`,
  };
}

/**
 * How many of the library's photos have their details read, of how many, with the time left at
 * the rate they are read now, `left` ms, while they are; or the jobs that read them, until the
 * catalog has counted. Like the folders' row, it always has a bar. The jobs' counts are left out
 * once it has counted, as they are of the photos picked to read next, not of those left.
 */
function photoDetails(details: DetailsProgress | null, lane: Jobs, left: number | null) {
  if (!details) {
    return { ...jobs('Photo details', lane), progress: 0 };
  }
  const { photos, read } = details;
  const progress = photos > 0 ? read / photos : 0;
  if (read >= photos) {
    return { active: false, label: 'Photo details', progress, value: 'All read' };
  }
  const reading = lane.running + lane.waiting > 0;
  const counts = `${read.toLocaleString()} of ${photos.toLocaleString()}`;
  return {
    active: reading,
    label: 'Photo details',
    progress,
    value: reading && left !== null ? `${counts} · ${timeLeft(left)}` : counts,
  };
}

/**
 * Every kind of work, a row each in a fixed order, with what of it is under way; `detailsLeft`
 * is how long reading the remaining photos' details takes, if known.
 */
export function activityDetails(activity: Activity, detailsLeft: number | null): StatusDetail[] {
  const { details, jobs: lanes, saving, skeleton, views, walk } = activity;
  const { decode, thumbnail } = lanes;
  // A thumbnail's job holds its read's turn until its photo is decoded, in a job of its own.
  const reading = Math.max(0, thumbnail.running - decode.running - decode.waiting);
  return [
    folders(walk, lanes.folder),
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
export const NOTHING_HEARD: StatusDetail[] = activityDetails(IDLE_ACTIVITY, null);

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
