import type { App } from 'electron';

// Longest a quit waits. The files are a few kilobytes on the local disk, written in milliseconds,
// and the workers save their Trash runs' records in about as long, so this is only reached if a
// disk or a share is stuck, and the app still quits soon after.
const MAX_WAIT_MS = 2000;

/** What a quit waits for, and what it does last. */
export interface QuitWork {
  /** What must be written before the app exits, such as the folders open in the tree. */
  pending: () => Promise<unknown>;
  /** Runs once `pending` settles or the wait runs out, just before the app exits. */
  stop: () => void;
  maxWaitMs?: number;
}

/**
 * Makes quitting wait until `pending` settles, at most `maxWaitMs`, so what the windows saved as
 * they closed is written before the app exits, then calls `stop`, which stops the library
 * workers once they have saved what they must. It waits in `will-quit`, which comes once every
 * window has closed and sent what it saves: `preventDefault` stops the quit, and `exit` ends the
 * app once the writes settle.
 *
 * `exit`, not `quit` again: calling `quit` after stopping it in `will-quit` left the app running
 * with no windows, holding its profile, so the next launch never showed one. By `will-quit`
 * every window has closed and every other `will-quit` listener has run, so `exit` skips nothing.
 */
export function waitBeforeQuitting(
  app: Pick<App, 'on' | 'exit'>,
  { pending, stop, maxWaitMs = MAX_WAIT_MS }: QuitWork,
): void {
  app.on('will-quit', (event) => {
    event.preventDefault();
    const timeout = new Promise((resolve) => {
      setTimeout(resolve, maxWaitMs).unref();
    });
    Promise.race([pending(), timeout])
      .catch(() => null)
      .finally(() => {
        stop();
        app.exit();
      });
  });
}
