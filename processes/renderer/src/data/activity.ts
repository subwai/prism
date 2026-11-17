import type { StatusDetail } from '@prism/design-system';
import { type Activity, IDLE_ACTIVITY, type Jobs, type WalkProgress } from '@prism/shared';
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

/** Every kind of work, a row each in a fixed order, with what of it is under way. */
export function activityDetails(activity: Activity): StatusDetail[] {
  const { jobs: lanes, saving, skeleton, views, walk } = activity;
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
    jobs('Photo details', lanes.details),
    jobs('Folder covers', lanes.tile),
    jobs('Conversions', lanes.conversion),
    row('Catalog writes', counted(saving, saving === 1 ? 'entry' : 'entries')),
    row('View order', views ? ['Sorting'] : []),
    row('Folder tree', skeleton ? ['Rebuilding'] : []),
  ];
}

/** What the rows say before the worker has said anything. */
export const NOTHING_HEARD: StatusDetail[] = activityDetails(IDLE_ACTIVITY);

/** What the open folder's worker last said it is busy with; `null` until it says. */
let activity: Activity | null = null;
const listeners = new Set<() => void>();
let stopHearing: (() => void) | undefined;

function hear(next: Activity) {
  activity = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  if (!stopHearing) {
    // What was heard before may be of another folder; the worker's bridge says it again.
    activity = null;
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
 * What the open folder's worker is busy with, as it last said, which only the status bar's
 * indicator reads, so nothing else renders again as it changes. The build prerenders without it.
 */
export function useActivity(): Activity | null {
  return useSyncExternalStore(
    subscribe,
    () => activity,
    () => null,
  );
}
