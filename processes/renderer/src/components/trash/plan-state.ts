import { NO_SHEET_FILTER, type SheetFilter } from '#data/trash-filters';
import { NO_SELECTION, type Selection } from '#data/trash-selection';
import { noTrashChoices, type TrashChoices } from '@prism/shared';
import { useState } from 'react';

/** How the sheet shows the plan: its rows to decide on, or every file they move. */
export type SheetMode = 'decide' | 'files';

export type PlanState = ReturnType<typeof usePlanState>;

/**
 * What the person decided, how they narrowed and chose the rows to decide on, and how the sheet
 * shows the plan, or explains it instead.
 */
export function usePlanState() {
  const [choices, setChoices] = useState<TrashChoices>(noTrashChoices);
  const [filter, setFilter] = useState<SheetFilter>(NO_SHEET_FILTER);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [mode, setMode] = useState<SheetMode>('decide');
  const [explaining, setExplaining] = useState(false);
  return {
    choices,
    collapsed,
    explaining,
    filter,
    mode,
    selection,
    setChoices,
    setCollapsed,
    setExplaining,
    // Narrowing the rows keeps the selection, so it can be gathered from several filters.
    setFilter,
    /** Shows the plan as `mode` says, leaving the explanation if it shows. */
    setMode(next: SheetMode) {
      setMode(next);
      setExplaining(false);
    },
    setSelection,
    toggleCollapsed(folderId: string) {
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (!next.delete(folderId)) {
          next.add(folderId);
        }
        return next;
      });
    },
  };
}
