import {
  AHEAD_ROWS,
  LIMITS,
  makesAhead,
  nearestFirst,
  type Priority,
  startable,
  type Weighed,
} from '#photos/worker/scheduling';
import { expect, test } from 'vitest';

function jobs(lane: Weighed['lane'], priority: Priority | null, count: number): Weighed[] {
  return Array.from({ length: count }, () => ({ lane, priority }));
}

test('the most wanted work starts first, and of the same priority the oldest', () => {
  const waiting: Weighed[] = [
    { lane: 'folder', priority: 'background' },
    { lane: 'folder', priority: 'visible' },
    { lane: 'folder', priority: 'ahead' },
    { lane: 'folder', priority: 'visible' },
  ];
  const running = jobs('folder', 'visible', LIMITS.folder.visible - 2);
  expect(startable(waiting, running)).toEqual([1, 3]);
});

test('lower priorities leave slots free for work on show', () => {
  const thumbnails = LIMITS.thumbnail.visible;
  // However many wait ahead of the scroll, one decode stays free.
  expect(startable(jobs('thumbnail', 'ahead', thumbnails + 4), [])).toHaveLength(
    LIMITS.thumbnail.ahead,
  );
  expect(LIMITS.thumbnail.ahead).toBeLessThan(thumbnails);
  const aheadRunning = jobs('thumbnail', 'ahead', LIMITS.thumbnail.ahead);
  expect(startable(jobs('thumbnail', 'visible', 1), aheadRunning)).toEqual([0]);
  // The re-check of every folder leaves folders for the window to ask for.
  const background = jobs('folder', 'background', LIMITS.folder.background);
  expect(startable(jobs('folder', 'background', 1), background)).toEqual([]);
  expect(startable(jobs('folder', 'visible', 1), background)).toEqual([0]);
});

test('no lane runs more than its limit, whatever the priorities', () => {
  const full = jobs('tile', 'visible', LIMITS.tile.visible);
  expect(startable(jobs('tile', 'visible', 3), full)).toEqual([]);
  expect(startable(jobs('folder', 'visible', 1), full)).toEqual([0]);
});

test('photos’ details make way for thumbnails on show, unless a view needs them', () => {
  const details = jobs('details', 'background', 1);
  expect(startable(details, [])).toEqual([0]);
  expect(startable(details, jobs('thumbnail', 'visible', 1))).toEqual([]);
  expect(startable([...jobs('conversion', 'visible', 1), ...details], [])).toEqual([0]);
  // A sort by date taken wants them now.
  expect(startable(jobs('details', 'ahead', 1), jobs('thumbnail', 'visible', 1))).toEqual([0]);
  // Folders are read beside thumbnails.
  expect(startable(jobs('folder', 'background', 1), jobs('thumbnail', 'visible', 1))).toEqual([0]);
});

test('work nothing wants is never started, and is not running work to make way for', () => {
  expect(startable(jobs('thumbnail', null, 2), [])).toEqual([]);
  expect(startable(jobs('details', 'background', 1), jobs('thumbnail', null, 1))).toEqual([0]);
});

test('thumbnails are made ahead of the scroll only in views of fewer than a thousand rows', () => {
  expect(AHEAD_ROWS).toBe(1000);
  expect(makesAhead(999)).toBe(true);
  expect(makesAhead(1000)).toBe(false);
});

test('thumbnails ahead of the scroll go outward from the rows on show, the next row first', () => {
  expect(nearestFirst(10, 4, 6)).toEqual([4, 5, 6, 3, 7, 2, 8, 1, 9, 0]);
  expect(nearestFirst(5, 0, 2)).toEqual([0, 1, 2, 3, 4]);
  expect(nearestFirst(5, 3, 5)).toEqual([3, 4, 2, 1, 0]);
  // Rows on show past the end, as the view shrank, start from its end.
  expect(nearestFirst(3, 5, 9)).toEqual([2, 1, 0]);
  expect(nearestFirst(0, 0, 4)).toEqual([]);
});
