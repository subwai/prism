import { activityLines, IDLE_LABEL, useActivity } from '#data/activity';
import { StatusIndicator } from '@prism/design-system';
import type { ReactNode } from 'react';

/**
 * The status bar's indicator, busy while the view is, as `busy` says, or while the folder's
 * worker is busy with anything else, which hovering it lists. Only it reads what the worker is
 * busy with, so the gallery does not render again each time that changes.
 */
export function ActivityStatus({ busy, children }: { busy: boolean; children: ReactNode }) {
  const activity = useActivity();
  const lines = activity ? activityLines(activity) : [];
  return (
    <StatusIndicator
      busy={busy || lines.length > 0}
      details={lines.length > 0 ? lines : [IDLE_LABEL]}
    >
      {children}
    </StatusIndicator>
  );
}
