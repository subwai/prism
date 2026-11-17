import type { Activity, Jobs, WalkProgress } from '@prism/shared';
import { useSyncExternalStore } from 'react';

/** What the status bar's indicator says when nothing is under way. */
export const IDLE_LABEL = 'Nothing running. The catalog is up to date.';

function counted(count: number, what: string) {
  return count > 0 ? [`${count.toLocaleString()} ${what}`] : [];
}

/** `label` with what is counted, or nothing if nothing is. */
function line(label: string, counts: string[]) {
  return counts.length > 0 ? [`${label} — ${counts.join(', ')}`] : [];
}

function jobs(label: string, { running, waiting }: Jobs) {
  return line(label, [...counted(running, 'running'), ...counted(waiting, 'waiting')]);
}

/** The walk under way, or else the folders read without one, as a walk's reads are its own. */
function folders(walk: WalkProgress | null, lane: Jobs) {
  if (!walk) {
    return jobs('Reading folders', lane);
  }
  const label = walk.full ? 'Reading every folder again' : 'Checking folders for changes';
  return [`${label} — ${walk.looked.toLocaleString()} of ${walk.found.toLocaleString()}`];
}

/** The work under way, a line each, in plain words with counts; none if nothing is. */
export function activityLines(activity: Activity): string[] {
  const { jobs: lanes, saving, skeleton, views, walk } = activity;
  const { decode, thumbnail } = lanes;
  // A thumbnail's job holds its read's turn until its photo is decoded, in a job of its own.
  const reading = Math.max(0, thumbnail.running - decode.running - decode.waiting);
  return [
    ...folders(walk, lanes.folder),
    ...line('Making thumbnails', [
      ...counted(reading, 'reading'),
      ...counted(decode.running, 'decoding'),
      ...counted(thumbnail.waiting + decode.waiting, 'waiting'),
    ]),
    ...jobs('Converting photos to show', lanes.conversion),
    ...jobs('Finding folders’ covers', lanes.tile),
    ...jobs('Reading photo details', lanes.details),
    ...line('Saving to the catalog', counted(saving, saving === 1 ? 'entry' : 'entries')),
    ...(views ? ['Sorting and filtering the view'] : []),
    ...(skeleton ? ['Rebuilding the folder tree'] : []),
  ];
}

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
