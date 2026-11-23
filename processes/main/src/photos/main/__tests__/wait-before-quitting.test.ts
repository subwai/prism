import { waitBeforeQuitting } from '#photos/main/wait-before-quitting';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * An app that quits as Electron's does: `quit` emits `will-quit`, and quits unless it is
 * prevented; `exit` quits at once.
 */
function fakeApp() {
  const willQuit: ((event: { preventDefault: () => void }) => void)[] = [];
  let hasQuit = false;
  const app = {
    exit: () => {
      hasQuit = true;
    },
    on: (_name: 'will-quit', listener: (event: { preventDefault: () => void }) => void) => {
      willQuit.push(listener);
      return app;
    },
    quit: () => {
      let isPrevented = false;
      const event = {
        preventDefault: () => {
          isPrevented = true;
        },
      };
      for (const listener of willQuit) {
        listener(event);
      }
      hasQuit = !isPrevented;
    },
  };
  return { app, hasQuit: () => hasQuit };
}

test('quitting waits for the pending writes, then quits', async () => {
  const { app, hasQuit } = fakeApp();
  const write = Promise.withResolvers<null>();
  waitBeforeQuitting(app as never, () => write.promise, 2000);
  app.quit();
  await vi.advanceTimersByTimeAsync(1000);
  expect(hasQuit()).toBe(false);
  write.resolve(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(hasQuit()).toBe(true);
});

test('a write that never settles keeps the app from quitting only until the timeout', async () => {
  const { app, hasQuit } = fakeApp();
  waitBeforeQuitting(app as never, () => Promise.withResolvers<null>().promise, 2000);
  app.quit();
  await vi.advanceTimersByTimeAsync(1999);
  expect(hasQuit()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(hasQuit()).toBe(true);
});
