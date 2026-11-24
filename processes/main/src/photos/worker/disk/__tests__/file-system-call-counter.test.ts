import { countFileSystemCalls } from '#photos/worker/disk/__tests__/file-system-call-counter';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function scratchFolder() {
  const made = await mkdtemp(path.join(tmpdir(), 'call-counter-'));
  onTestFinished(() => rm(made, { force: true, recursive: true }));
  return realpath(made);
}

test('counts the calls inside the folder, by name, whichever way they are imported', async () => {
  const folder = await scratchFolder();
  await writeFile(path.join(folder, 'a.jpg'), 'a');
  const counter = countFileSystemCalls(folder);
  onTestFinished(() => counter.stop());

  await stat(path.join(folder, 'a.jpg'));
  await readdir(folder);
  statSync(path.join(folder, 'a.jpg'));
  existsSync(path.join(folder, 'b.jpg'));
  await stat(tmpdir());

  expect(counter.counts()).toEqual({ exists: 1, readdir: 1, stat: 2 });
});

test('starts again from nothing when reset, and counts nothing once stopped', async () => {
  const folder = await scratchFolder();
  const counter = countFileSystemCalls(folder);
  await stat(folder);
  counter.reset();
  expect(counter.counts()).toEqual({});

  counter.stop();
  await stat(folder);
  expect(counter.counts()).toEqual({});
});
