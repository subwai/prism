import { activityDetails, NOTHING_HEARD, useActivity } from '#data/activity';
import { StatusIndicator } from '@prism/design-system';
import type { ReactNode } from 'react';

/**
 * The status bar's indicator, busy while the view is, as `busy` says, or while the folder's
 * worker is busy with anything else, which hovering it lists. Only it reads what the worker is
 * busy with, so the gallery does not render again each time that changes.
 */
export function ActivityStatus({ busy, children }: { busy: boolean; children: ReactNode }) {
  const activity = useActivity();
  const items = activity ? activityDetails(activity) : NOTHING_HEARD;
  const working = items.some((item) => item.active);
  return (
    <StatusIndicator
      busy={busy || working}
      details={{
        items,
        title: working ? 'Working in the background' : 'Nothing running · catalog up to date',
      }}
    >
      {children}
    </StatusIndicator>
  );
}
