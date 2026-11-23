import { folderChangeReports } from '#photos/worker/messages/folder-change-reports';
import type { WorkerEvent } from '@prism/shared';
import { expect, onTestFinished, test, vi } from 'vitest';

test('folder changes are sent a while after the first, together, and not when there are none', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const sent: WorkerEvent[] = [];
  const reports = folderChangeReports((event) => sent.push(event));
  reports.report({ folders: [], tiles: [] });
  reports.report({ folders: ['Trips'], tiles: [] });
  reports.report({ folders: ['Trips'], tiles: ['Trips/2024'] });
  expect(sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(250);
  expect(sent).toEqual([
    {
      kind: 'update',
      update: { changes: null, folders: ['Trips'], tiles: ['Trips/2024'], views: [] },
    },
  ]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
});
