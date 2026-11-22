import {
  FOCUSED_LIMITS,
  jobsToStart,
  LIMITS,
  type PrioritizedJob,
  type Priority,
} from '#photos/worker/scheduler/limits';
import { expect, test } from 'vitest';

function jobs(
  kind: PrioritizedJob['kind'],
  priority: Priority | null,
  count: number,
): PrioritizedJob[] {
  return Array.from({ length: count }, () => ({ kind, priority }));
}

test('the most wanted work starts first, and of the same priority the oldest', () => {
  const waiting: PrioritizedJob[] = [
    { kind: 'folder', priority: 'background' },
    { kind: 'folder', priority: 'visible' },
    { kind: 'folder', priority: 'ahead' },
    { kind: 'folder', priority: 'visible' },
  ];
  const running = jobs('folder', 'visible', LIMITS.folder.visible - 2);
  expect(jobsToStart(waiting, running)).toEqual([1, 3]);
});

test('lower priorities leave slots free for work on show', () => {
  // However many wait ahead of the scroll, reads and a decode stay free.
  for (const kind of ['thumbnail', 'decode'] as const) {
    expect(jobsToStart(jobs(kind, 'ahead', LIMITS[kind].visible + 4), [])).toHaveLength(
      LIMITS[kind].ahead,
    );
    expect(LIMITS[kind].ahead).toBeLessThan(LIMITS[kind].visible);
    const aheadRunning = jobs(kind, 'ahead', LIMITS[kind].ahead);
    expect(jobsToStart(jobs(kind, 'visible', 1), aheadRunning)).toEqual([0]);
  }
  // More photos are read at once than decoded.
  expect(LIMITS.thumbnail.visible).toBeGreaterThan(LIMITS.decode.visible);
  // The re-check of every folder leaves folders for the window to ask for.
  const background = jobs('folder', 'background', LIMITS.folder.background);
  expect(jobsToStart(jobs('folder', 'background', 1), background)).toEqual([]);
  expect(jobsToStart(jobs('folder', 'visible', 1), background)).toEqual([0]);
});

test('no kind runs more than its limit, whatever the priorities', () => {
  const full = jobs('tile', 'visible', LIMITS.tile.visible);
  expect(jobsToStart(jobs('tile', 'visible', 3), full)).toEqual([]);
  expect(jobsToStart(jobs('folder', 'visible', 1), full)).toEqual([0]);
});

test('photos’ details make way for thumbnails on show, unless a view needs them', () => {
  const details = jobs('details', 'background', 1);
  expect(jobsToStart(details, [])).toEqual([0]);
  expect(jobsToStart(details, jobs('thumbnail', 'visible', 1))).toEqual([]);
  expect(jobsToStart([...jobs('conversion', 'visible', 1), ...details], [])).toEqual([0]);
  // A sort by date taken priority them now.
  expect(jobsToStart(jobs('details', 'ahead', 1), jobs('thumbnail', 'visible', 1))).toEqual([0]);
  // Folders are read beside thumbnails.
  expect(jobsToStart(jobs('folder', 'background', 1), jobs('thumbnail', 'visible', 1))).toEqual([
    0,
  ]);
});

test('more photos’ details are read in the background while Prism is focused', () => {
  const waiting = jobs('details', 'background', 16);
  expect(jobsToStart(waiting, [])).toHaveLength(4);
  expect(jobsToStart(waiting, [], FOCUSED_LIMITS)).toHaveLength(12);
  // They still make way for thumbnails on show, and leave room for a view that needs them.
  expect(jobsToStart(waiting, jobs('thumbnail', 'visible', 1), FOCUSED_LIMITS)).toEqual([]);
  const background = jobs('details', 'background', 12);
  expect(jobsToStart(jobs('details', 'ahead', 8), background, FOCUSED_LIMITS)).toHaveLength(4);
  // Nothing else changes.
  expect({ ...FOCUSED_LIMITS, details: LIMITS.details }).toEqual(LIMITS);
  expect(FOCUSED_LIMITS.details).toEqual({ ...LIMITS.details, background: 12 });
});

test('running work over a lowered limit goes on, and none starts until fewer run', () => {
  const running = jobs('details', 'background', 12);
  expect(jobsToStart(jobs('details', 'background', 1), running)).toEqual([]);
  expect(jobsToStart(jobs('details', 'background', 1), running.slice(0, 3))).toEqual([0]);
});

test('work nothing priority is never started, and is not running work to make way for', () => {
  expect(jobsToStart(jobs('thumbnail', null, 2), [])).toEqual([]);
  expect(jobsToStart(jobs('details', 'background', 1), jobs('thumbnail', null, 1))).toEqual([0]);
});
