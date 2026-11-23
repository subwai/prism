import { activityDetails, IDLE_ROWS } from '#data/activity/activity-rows';
import { useActivity, useMinuteClock } from '#data/activity/activity-store';
import { StatusIndicator } from '@prism/design-system';
import type { ReactNode } from 'react';

/**
 * What the indicator's hint is titled; `checked` is whether the last look at every folder looked
 * at them all.
 */
function titleOf(offline: boolean, working: boolean, checked: boolean) {
  if (offline) {
    return 'Share offline · showing the catalog';
  }
  if (working) {
    return 'Working in the background';
  }
  return checked ? 'Nothing running · catalog up to date' : 'Nothing running';
}

/**
 * The status bar's indicator, busy while the view is, as `busy` says, or while the folder's
 * worker is busy with anything else, which hovering it lists. Only it reads what the worker is
 * busy with, so the gallery does not render again each time that changes. While the share is
 * offline, the work waits for it rather than running, so it does not spin for it.
 */
export function ActivityStatus({ busy, children }: { busy: boolean; children: ReactNode }) {
  const reported = useActivity();
  const now = useMinuteClock();
  const items = reported
    ? activityDetails(reported.activity, reported.detailsLeft, now)
    : IDLE_ROWS;
  const offline = reported?.activity.offline ?? false;
  const checked = reported?.activity.lastCheck?.complete ?? false;
  const working = items.some((item) => item.active);
  return (
    <StatusIndicator
      busy={busy || (working && !offline)}
      details={{ items, title: titleOf(offline, working, checked) }}
    >
      {children}
    </StatusIndicator>
  );
}
