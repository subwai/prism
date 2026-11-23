import { openSqlite, WRITER_SETTINGS } from '#sqlite/open-sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { expect, onTestFinished, test } from 'vitest';

async function scratchFile() {
  const folder = await mkdtemp(path.join(tmpdir(), 'open-sqlite-'));
  onTestFinished(() => rm(folder, { force: true, recursive: true }));
  return path.join(folder, 'test.db');
}

test('opens the file set up, in write-ahead-log mode with the writer settings', async () => {
  const database = openSqlite(await scratchFile(), {
    busyTimeoutMs: 100,
    setUp: (connection) => connection.exec(WRITER_SETTINGS),
  });
  onTestFinished(() => database.close());
  expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
});

test('closes the connection again if setting it up fails', () => {
  let opened: DatabaseSync | undefined;
  expect(() =>
    openSqlite(':memory:', {
      busyTimeoutMs: 100,
      setUp: (connection) => {
        opened = connection;
        throw new Error('set-up failed');
      },
    }),
  ).toThrow('set-up failed');
  expect(opened?.isOpen).toBe(false);
});
