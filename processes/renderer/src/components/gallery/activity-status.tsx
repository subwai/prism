import { activityDetails, NOTHING_HEARD, useActivity } from '#data/activity';
import { StatusIndicator } from '@prism/design-system';
import type { ReactNode } from 'react';

/** What the indicator's hint is titled. */
function titleOf(offline: boolean, working: boolean) {
  if (offline) {
    return 'Share offline · showing the catalog';
  }
  return working ? 'Working in the background' : 'Nothing running · catalog up to date';
}

/**
 * The status bar's indicator, busy while the view is, as `busy` says, or while the folder's
 * worker is busy with anything else, which hovering it lists. Only it reads what the worker is
 * busy with, so the gallery does not render again each time that changes. While the share is
 * offline, the work waits for it rather than running, so it does not spin for it.
 */
export function ActivityStatus({ busy, children }: { busy: boolean; children: ReactNode }) {
  const heard = useActivity();
  const items = heard ? activityDetails(heard.activity, heard.detailsLeft) : NOTHING_HEARD;
  const offline = heard?.activity.offline ?? false;
  const working = items.some((item) => item.active);
  return (
    <StatusIndicator
      busy={busy || (working && !offline)}
      details={{ items, title: titleOf(offline, working) }}
    >
      {children}
    </StatusIndicator>
  );
}
