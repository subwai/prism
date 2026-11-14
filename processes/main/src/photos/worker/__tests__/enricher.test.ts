import { Enricher } from '#photos/worker/enricher';
import { Scheduler } from '#photos/worker/scheduler';
import type { Catalog } from '@prism/catalog';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, onTestFinished, test } from 'vitest';

/** An enricher over a catalog that wants `photo` read once, then nothing. */
function enricher() {
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
  const scheduler = new Scheduler(controller.signal);
  const reader = new Enricher({ catalog, root: '/nowhere', scheduler, signal: controller.signal });
  reader.start();
  return { controller, reader, scheduler };
}

test('waiting for thumbnails to make way leaves no listeners behind', async () => {
  const { controller, scheduler } = enricher();
  // A thumbnail on show that takes its time, which background reads make way for.
  const made = Promise.withResolvers<null>();
  scheduler
    .run(
      'thumbnail',
      'on show',
      () => 'visible',
      () => made.promise,
    )
    .catch(() => null);
  await delay(300);
  expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(2);
  made.resolve(null);
});

test('waiting for more photos to read leaves no listeners behind', async () => {
  const { controller, reader } = enricher();
  for (let nudge = 0; nudge < 20; nudge += 1) {
    reader.nudge();
    await delay(5);
  }
  expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(2);
});
