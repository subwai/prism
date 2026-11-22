import { timeLeft } from '#data/activity/details-estimate';
import type { StatusDetail } from '@prism/design-system';
import {
  type Activity,
  type DetailsProgress,
  type FolderCheck,
  IDLE_ACTIVITY,
  type JobCounts,
  type WalkProgress,
} from '@prism/shared';

/** What a row says when its kind of work is not under way. */
const IDLE = 'Idle';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function counted(count: number, what: string) {
  return count > 0 ? [`${count.toLocaleString()} ${what}`] : [];
}

/**
 * The row for `label`, listing `counts`, or saying it is idle when there are none. Every row is
 * always there, in the same place, so the eye can follow one as its counts change.
 */
function statusRow(label: string, counts: string[]): StatusDetail {
  return counts.length > 0
    ? { active: true, label, value: counts.join(' · ') }
    : { active: false, label, value: IDLE };
}

function jobsRow(label: string, { running, waiting }: JobCounts) {
  return statusRow(label, [...counted(running, 'running'), ...counted(waiting, 'waiting')]);
}

/** How long ago `ms` was, at `now`. It is rounded down so the text changes seldom. */
function timeAgo(ms: number, now: number) {
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
function walkFraction({ found, looked }: WalkProgress) {
  return found > 0 ? looked / found : 0;
}

/**
 * What the last check of every folder left behind: not checked yet this session, up to date, or
 * stopped part-way, with its bar as far as it got.
 */
function lastCheckStatus(check: FolderCheck | null, now: number): Omit<StatusDetail, 'label'> {
  if (!check) {
    return { active: false, progress: 0, value: 'Not checked yet' };
  }
  if (check.complete) {
    return {
      active: false,
      progress: 1,
      value: `Up to date · checked ${timeAgo(check.endedMs, now)}`,
    };
  }
  const percent = Math.floor(walkFraction(check) * 100);
  return {
    active: false,
    progress: walkFraction(check),
    value: check.fullRead
      ? `Full read paused · ${percent}% read`
      : `Check stopped · ${percent}% checked`,
  };
}

/**
 * The Folders row. In order, it shows the first of these that applies:
 * - the walk under way, and how far it has got;
 * - that the share is offline;
 * - folders being read one at a time, outside a walk;
 * - what the last check of every folder left behind.
 *
 * It always has a progress bar, so the row keeps its height.
 */
function foldersRow(
  { lastCheck, offline, walk }: Activity,
  jobs: JobCounts,
  now: number,
): StatusDetail {
  const label = 'Folders';
  if (walk) {
    const how = walk.fullRead ? 'Reading all' : 'Checking';
    const counts = `${walk.looked.toLocaleString()} of ${walk.found.toLocaleString()}`;
    // A walk waits while the share is offline, rather than failing.
    return {
      active: !offline,
      label,
      progress: walkFraction(walk),
      value: `${offline ? 'Share offline' : how} · ${counts}`,
    };
  }
  const last = lastCheckStatus(lastCheck, now);
  if (offline) {
    return { ...last, label, value: 'Share offline' };
  }
  if (jobs.running + jobs.waiting > 0) {
    return { ...jobsRow(label, jobs), progress: last.progress };
  }
  return { ...last, label };
}

/**
 * The Photo details row: how many of the library's photos have their details read, of how many.
 * Photos whose details could not be read count as read, and the row says how many there are.
 * While reading, it also says the time left, `left` ms.
 *
 * Until the catalog has counted the photos, it shows the reading jobs instead. Once counted, the
 * job counts are left out: they count only the photos picked to read next, not all that are left.
 * Like the Folders row, it always has a bar.
 */
function photoDetailsRow(details: DetailsProgress | null, jobs: JobCounts, left: number | null) {
  if (!details) {
    return { ...jobsRow('Photo details', jobs), progress: 0 };
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
  const reading = jobs.running + jobs.waiting > 0;
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
 * The activity panel's rows: one per kind of work, always in the same order.
 * - `detailsLeft` is how long reading the remaining photos' details will take, if known.
 * - `now` is the time, for saying how long ago the folders were checked.
 */
export function activityDetails(
  activity: Activity,
  detailsLeft: number | null,
  now: number,
): StatusDetail[] {
  const { details, jobs, unsavedEntries, rebuildingTree, rebuildingViews } = activity;
  const { decode, thumbnail } = jobs;
  // A thumbnail job keeps its place in the read queue while its photo is decoded, which is a
  // job of its own, so those decoding are taken out of the ones reading.
  const reading = Math.max(0, thumbnail.running - decode.running - decode.waiting);
  return [
    foldersRow(activity, jobs.folder, now),
    statusRow('Thumbnails', [
      ...counted(reading, 'reading'),
      ...counted(decode.running, 'decoding'),
      ...counted(thumbnail.waiting + decode.waiting, 'waiting'),
    ]),
    photoDetailsRow(details, jobs.details, detailsLeft),
    jobsRow('Folder covers', jobs.tile),
    jobsRow('Conversions', jobs.conversion),
    statusRow(
      'Catalog writes',
      counted(unsavedEntries, unsavedEntries === 1 ? 'entry' : 'entries'),
    ),
    statusRow('View order', rebuildingViews ? ['Sorting'] : []),
    statusRow('Folder tree', rebuildingTree ? ['Rebuilding'] : []),
  ];
}

/** The rows before the worker has reported anything. */
export const IDLE_ROWS: StatusDetail[] = activityDetails(IDLE_ACTIVITY, null, 0);
