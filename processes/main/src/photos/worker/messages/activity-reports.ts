import type { Activity } from '@prism/shared';

// Activity is sent at most this often, so the scheduler's thousands of jobs a minute cost the
// window a few messages a second.
const ACTIVITY_MS = 250;

/**
 * Sends `current()` when it changes. Calling `changed` says it may have: it is then sent once,
 * a moment later, and only if it differs from what was sent last, so nothing is sent while
 * nothing changes. `last` returns what was sent last, for a window that connects meanwhile.
 */
export function activityReports(current: () => Activity, send: (activity: Activity) => void) {
  let last = current();
  let sent = JSON.stringify(last);
  let timer: NodeJS.Timeout | undefined;
  return {
    changed(): void {
      timer ??= setTimeout(() => {
        timer = undefined;
        const now = current();
        const text = JSON.stringify(now);
        if (text !== sent) {
          last = now;
          sent = text;
          send(now);
        }
      }, ACTIVITY_MS);
    },
    last: () => last,
  };
}
