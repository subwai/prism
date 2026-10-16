import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ElectronApplication, Page } from 'playwright-core';
import type * as Rrweb from 'rrweb-snapshot';
import { recordArtifact, type TestContext } from 'vitest';

/*
 * Experimental: fills the Vitest UI's trace view for Electron tests.
 *
 * Vitest only records that view in browser mode, by snapshotting the page with rrweb-snapshot
 * and storing the snapshots as `internal:browserTrace` artifacts. Neither Vitest nor
 * Playwright can do that for an Electron window, so this mirrors Vitest's recorder
 * (`@vitest/browser`'s `takeSnapshot` and `recordBrowserTraceEntry`): it snapshots the window
 * after every Playwright action. Both the artifact format and Playwright's instrumentation
 * hook are private, so a Vitest or Playwright update can break this.
 */

declare global {
  // oxlint-disable-next-line no-var -- A global declaration has to be a `var`.
  var rrwebSnapshot: typeof Rrweb | undefined;
}

/** Playwright's API call record, as its client instrumentation reports it. */
interface ApiZone {
  apiName: string;
  frames: { file: string; line: number; column: number }[];
  error?: Error;
}

interface Listener {
  onApiCallEnd: (zone: ApiZone) => void;
}

interface Instrumentation {
  addListener: (listener: Listener) => void;
  removeListener: (listener: Listener) => void;
}

/** The UMD build, which defines `rrwebSnapshot` on the window it runs in. */
const rrweb = await readFile(createRequire(import.meta.url).resolve('rrweb-snapshot'), 'utf8');

/** Actions that change what the window shows. Reads, such as `evaluate` in polls, are left out. */
const ACTION =
  /^(?:keyboard|mouse|touchscreen)\.|^locator\.(?:check|clear|click|dblclick|dragTo|fill|focus|hover|press|pressSequentially|selectOption|tap|uncheck|waitFor)$/u;

/** The same pseudo-classes Vitest restores in the replayed DOM. */
const PSEUDO_CLASSES = [':hover', ':active', ':focus', ':focus-visible', ':focus-within'];

/** The app's own URLs, which the Vitest UI can't load. */
const APP_URL = /(?:app|media):\/\/[^\s"'()\\]+/gu;

/** Photos shrink to this width, so a snapshot carries a preview rather than the original. */
const IMAGE_WIDTH = 1600;

const inlined = new Map<string, Promise<string>>();

/** Fetches an app URL through the main process, which serves it, as a data URL. */
function dataURL(app: ElectronApplication, url: string) {
  let data = inlined.get(url);
  if (!data) {
    data = app.evaluate(
      async ({ nativeImage, net }, [href, width]) => {
        const response = await net.fetch(href);
        const type = response.headers.get('content-type') ?? 'application/octet-stream';
        const buffer = Buffer.from(await response.arrayBuffer());
        // Only JPEG and PNG decode here; anything else, like WebP thumbnails, stays as is.
        const image = nativeImage.createFromBuffer(buffer);
        if (image.isEmpty()) {
          return `data:${type};base64,${buffer.toString('base64')}`;
        }
        const small = image.getSize().width > width ? image.resize({ width }) : image;
        return `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}`;
      },
      [url, IMAGE_WIDTH] as const
    );
    inlined.set(url, data);
  }
  return data;
}

/** Replaces the app's URLs in a snapshot with data URLs, so the replay shows photos and fonts. */
async function inline(app: ElectronApplication, snap: unknown) {
  const json = JSON.stringify(snap);
  const urls = [...new Set(json.match(APP_URL))];
  const data = new Map(
    await Promise.all(urls.map(async (url) => [url, await dataURL(app, url)] as const))
  );
  return JSON.parse(json.replace(APP_URL, (url) => data.get(url) ?? url)) as unknown;
}

/** Serializes the window's DOM in the shape Vitest's trace view rebuilds. */
async function snapshot(page: Page) {
  if (!(await page.evaluate(() => Boolean(globalThis.rrwebSnapshot)))) {
    await page.evaluate(rrweb);
  }
  return page.evaluate((pseudoClasses) => {
    if (!globalThis.rrwebSnapshot) {
      throw new Error('rrweb-snapshot is not loaded');
    }
    const mirror = globalThis.rrwebSnapshot.createMirror();
    const serialized = globalThis.rrwebSnapshot.snapshot(document, {
      mirror,
      // The replay doesn't run scripts, so it would show their placeholders instead.
      slimDOM: { script: true }
    });
    return {
      pseudoClassIds: Object.fromEntries(
        pseudoClasses.map((name) => [
          name,
          [...document.querySelectorAll(name)]
            .map((node) => mirror.getId(node))
            .filter((id) => id !== -1)
        ])
      ),
      // oxlint-disable-next-line id-length -- Vitest's trace format names them x and y.
      scroll: { x: window.scrollX, y: window.scrollY },
      serialized,
      viewport: { height: window.innerHeight, width: window.innerWidth }
    };
  }, PSEUDO_CLASSES);
}

/** Records a trace entry for every action on `page` until the returned function is awaited. */
export function traceView(app: ElectronApplication, page: Page, task: TestContext['task']) {
  // The hook `@playwright/test` traces with.
  const { _instrumentation: instrumentation } = app as unknown as {
    _instrumentation: Instrumentation;
  };
  const start = performance.now();
  const pending: Promise<unknown>[] = [];

  function record(
    name: string,
    kind: string,
    status?: string,
    location?: ApiZone['frames'][number]
  ) {
    const startTime = performance.now() - start;
    pending.push(
      snapshot(page)
        .then((snap) => inline(app, snap))
        .then((snap) =>
          recordArtifact(task, {
            data: {
              entries: [{ kind, location, name, snapshot: snap, startTime, status }],
              recordCanvas: false,
              repeats: task.result?.repeatCount ?? 0,
              retry: task.result?.retryCount ?? 0
            },
            type: 'internal:browserTrace'
          })
        )
    );
  }

  const listener: Listener = {
    onApiCallEnd(zone) {
      if (ACTION.test(zone.apiName)) {
        record(zone.apiName, 'action', zone.error ? 'fail' : 'pass', zone.frames[0]);
      }
    }
  };
  instrumentation.addListener(listener);

  return async () => {
    instrumentation.removeListener(listener);
    record('end of test', 'mark', task.result?.state === 'fail' ? 'fail' : 'pass');
    await Promise.all(pending);
  };
}
