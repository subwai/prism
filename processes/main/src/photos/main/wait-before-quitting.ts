import type { App } from 'electron';

// Longest a quit waits. The files are a few kilobytes on the local disk, written in milliseconds,
// so this is only reached if the disk is stuck, and the app still quits soon after.
const MAX_WAIT_MS = 2000;

/**
 * Makes quitting wait until `pending` settles, at most `maxWaitMs`, so what the windows saved as
 * they closed, such as the folders open in the tree, is written before the app exits. It waits
 * in `will-quit`, which comes once every window has closed and sent what it saves:
 * `preventDefault` stops the quit, and `exit` ends the app once the writes settle.
 *
 * `exit`, not `quit` again: calling `quit` after stopping it in `will-quit` left the app running
 * with no windows, holding its profile, so the next launch never showed one. By `will-quit`
 * every window has closed and every other `will-quit` listener has run, so `exit` skips nothing.
 */
export function waitBeforeQuitting(
  app: Pick<App, 'on' | 'exit'>,
  pending: () => Promise<unknown>,
  maxWaitMs = MAX_WAIT_MS,
): void {
  app.on('will-quit', (event) => {
    event.preventDefault();
    const timeout = new Promise((resolve) => {
      setTimeout(resolve, maxWaitMs).unref();
    });
    Promise.race([pending(), timeout])
      .catch(() => null)
      .finally(() => app.exit());
  });
}
