import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Locator } from 'playwright-core';
import sharp from 'sharp';
import { inject, type TestContext } from 'vitest';

type Annotate = TestContext['annotate'];

const FOLDER = path.resolve(import.meta.dirname, '../tests/__screenshots__');

// Rendering repeats exactly on one machine, give or take a step of antialiasing. The theme's
// fills are faint (a tenth of white over grey), so a change to one, such as a corner's radius,
// moves pixels by only a few steps: anything more than this is a change.
const CHANNEL_TOLERANCE = 2;
// The share of pixels that may differ before it fails: a few stray edges, not a restyle.
const PIXEL_TOLERANCE = 0.00002;
// Screenshots taken until two in a row match, at most this many, this far apart.
const MAX_SHOTS = 10;
const SHOT_INTERVAL_MS = 100;

/**
 * A screenshot of `locator` once it stops changing, as Playwright's `toHaveScreenshot` waits for.
 * Scrolling a section into view can capture it before Chromium has finished rasterising it,
 * which a busy machine makes likelier, leaving a few corners and gradient steps a little off.
 */
async function stableScreenshot(locator: Locator) {
  const shoot = () => locator.screenshot({ animations: 'disabled', caret: 'hide' });
  let previous = await shoot();
  for (let shot = 1; shot < MAX_SHOTS; shot += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Each shot is compared with the one before.
    await delay(SHOT_INTERVAL_MS);
    // oxlint-disable-next-line no-await-in-loop -- As above.
    const current = await shoot();
    if (current.equals(previous)) {
      return current;
    }
    previous = current;
  }
  return previous;
}

/** The share of pixels that differ visibly between two PNGs, or 1 if their sizes differ. */
async function difference(expected: string, actual: Buffer) {
  const [before, after] = await Promise.all(
    [expected, actual].map((source) =>
      sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  if (!before || !after) {
    return 1;
  }
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) {
    return 1;
  }
  let differing = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      const offset = index + channel;
      if (Math.abs((before.data[offset] ?? 0) - (after.data[offset] ?? 0)) > CHANNEL_TOLERANCE) {
        differing += 1;
        break;
      }
    }
  }
  return differing / (before.data.length / 4);
}

/**
 * Compares `locator` with its recorded screenshot, `__screenshots__/<name>-<platform>.png`.
 * Each platform renders text its own way, so each keeps its own. A missing one is recorded
 * (and the test says so), as is every one with `-u`; a changed one fails, leaving what it saw
 * beside it as `.actual.png` to compare and, if the change is wanted, to record with `-u`.
 */
export async function expectScreenshot(locator: Locator, name: string, annotate: Annotate) {
  const file = path.join(FOLDER, `${name}-${process.platform}.png`);
  const actualFile = file.replace(/\.png$/u, '.actual.png');
  const actual = await stableScreenshot(locator);
  await mkdir(FOLDER, { recursive: true });
  const mode = inject('screenshots');
  if (mode === 'all' || !existsSync(file)) {
    await writeFile(file, actual);
    await rm(actualFile, { force: true });
    await annotate(`Recorded ${path.relative(process.cwd(), file)}`, 'notice');
    return;
  }
  const share = await difference(file, actual);
  if (share > PIXEL_TOLERANCE) {
    await writeFile(actualFile, actual);
    throw new Error(
      `${name} differs from its screenshot in ${(share * 100).toFixed(2)}% of pixels; see ` +
        `${path.relative(process.cwd(), actualFile)}, and run with -u if the change is wanted`,
    );
  }
  await rm(actualFile, { force: true });
}
