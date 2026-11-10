import { Enricher } from '#photos/worker/enricher';
import type { Catalog } from '@prism/catalog';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, onTestFinished, test } from 'vitest';

/** An enricher over a catalog that wants `photo` read once, then nothing. */
function enricher(busy: () => boolean) {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  let asked = 0;
  const catalog = {
    call(method: string) {
      asked += method === 'wanted' ? 1 : 0;
      return Promise.resolve(method === 'wanted' && asked === 1 ? [{ id: 'a.jpg', item: 1 }] : []);
    },
    write() {
      // Nothing is read, so nothing is written.
    },
  } as unknown as Catalog;
  const reader = new Enricher({ busy, catalog, root: '/nowhere', signal: controller.signal });
  reader.start();
  return { controller, reader };
}

test('waiting for thumbnails to make way leaves no listeners behind', async () => {
  const { controller } = enricher(() => true);
  // Ten turns of waiting for the thumbnails.
  await delay(1000);
  expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(2);
});

test('waiting for more photos to read leaves no listeners behind', async () => {
  const { controller, reader } = enricher(() => false);
  for (let nudge = 0; nudge < 20; nudge += 1) {
    reader.nudge();
    await delay(5);
  }
  expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(2);
});
