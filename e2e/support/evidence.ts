import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication } from 'playwright-core';
import type { TestContext } from 'vitest';

/** Where a failed test keeps what shows how it failed, which CI uploads. */
const RESULTS = path.resolve(import.meta.dirname, '../test-results');

// A wait for the window that never ends would keep its test's evidence from being saved.
const SCREENSHOT_MS = 5000;

/** What an app has logged, and where the test it is used for began in it. */
interface Recording {
  /** Names the app's files in the test's evidence folder. */
  name: string;
  /** Everything the app has logged, in chunks as they came. */
  lines: string[];
  /** Where the current test's part of `lines` starts. */
  testStartsAt: number;
  closed: boolean;
}

const recordings = new WeakMap<ElectronApplication, Recording>();
let appsLaunched = 0;

/**
 * Starts recording `app` as it launches: a Playwright trace, with a screenshot and the window's
 * DOM after every action, and its debug logs, which the launch's `DEBUG` turns on.
 */
export async function startRecording(app: ElectronApplication) {
  appsLaunched += 1;
  const recording: Recording = {
    closed: false,
    lines: [],
    name: `app-${appsLaunched}`,
    testStartsAt: 0,
  };
  recordings.set(app, recording);
  app.process().stderr?.on('data', (chunk: Buffer) => recording.lines.push(chunk.toString()));
  app.once('close', () => {
    recording.closed = true;
  });
  await app.context().tracing.start({ screenshots: true, snapshots: true });
}

/** Starts the part of `app`'s trace and logs that a test keeps if it fails. */
export async function startTest(app: ElectronApplication) {
  const recording = recordings.get(app);
  if (recording) {
    recording.testStartsAt = recording.lines.length;
    await app.context().tracing.startChunk();
  }
}

/** `text` as a file name. */
function fileName(text: string) {
  return text.replaceAll(/[^\w.-]+/gu, '-').slice(0, 120);
}

/** The folder a test's evidence goes in, named for its file and its name. */
function folderOf(task: TestContext['task']) {
  return path.join(RESULTS, fileName(task.fullName));
}

/**
 * Ends the test's part of `app`'s trace and logs. If the test failed, keeps the trace, a
 * screenshot of the window as the test ended, and the logs, beside those of the test's other
 * apps. If the test closed the app itself, for example to launch it again, only the logs are
 * kept: the trace closed with the app.
 */
export async function endTest(app: ElectronApplication, task: TestContext['task']) {
  const recording = recordings.get(app);
  if (!recording) {
    return;
  }
  const failed = task.result?.state === 'fail';
  const folder = folderOf(task);
  if (failed) {
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, `${recording.name}.log`),
      recording.lines.slice(recording.testStartsAt).join(''),
    );
    const errors = (task.result?.errors ?? []).map((error) => error.stack ?? error.message);
    await writeFile(path.join(folder, 'errors.txt'), errors.join('\n\n'));
  }
  if (recording.closed) {
    return;
  }
  const page = await app.firstWindow();
  if (failed) {
    await page
      .screenshot({ path: path.join(folder, `${recording.name}.png`), timeout: SCREENSHOT_MS })
      .catch(() => null);
  }
  await app
    .context()
    .tracing.stopChunk(failed ? { path: path.join(folder, `${recording.name}-trace.zip`) } : {});
}
