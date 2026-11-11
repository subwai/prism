import type { PlanState } from '#components/trash/plan-state';
import { SheetFooter } from '#components/trash/sheet-footer';
import { TrashDefaultsBar } from '#components/trash/trash-defaults';
import { type Click, TrashList } from '#components/trash/trash-list';
import { decideRows, DECISION_LABELS, rowsOf } from '#data/trash';
import {
  linesOf,
  rowsShown,
  sheetGroups,
  TAB_LABELS,
  tabCounts,
  TRASH_TABS,
} from '#data/trash-filters';
import {
  NO_SELECTION,
  selectAll,
  selectedAmong,
  selectRow,
  selectRows,
} from '#data/trash-selection';
import { useCommands } from '#keyboard/commands';
import { Button, ChoiceToggle, IconButton, TokenSearchField } from '@prism/design-system';
import type { PhotoFilter, TrashDecision, TrashPlan, TrashRow } from '@prism/shared';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

/** The decisions to offer for the selection: those any of its rows offers, and how many do. */
function offered(rows: TrashRow[]) {
  return (['keep', 'only', 'rescue', 'trash'] as const).flatMap((decision) => {
    const count = rows.filter((row) => row.options.includes(decision)).length;
    return count > 0 ? [{ count, decision }] : [];
  });
}

/**
 * The plan's rows to decide on, under their folders: one click each, or many at once by the
 * defaults, a folder's heading, or a selection gathered through the tabs and filters.
 */
export function DecideView({
  data,
  plan,
  filter,
  folderName,
  onClose,
}: {
  data: TrashPlan;
  plan: PlanState;
  folderName: string;
  /** The filter the plan is of, whose fields each row shows its values of. */
  filter: PhotoFilter;
  onClose: () => void;
}) {
  const rows = rowsOf(data);
  const lines = linesOf(data, plan.filter, plan.collapsed);
  const shown = rowsShown(lines);
  const selected = selectedAmong(plan.selection, rows);
  const hidden = selected.length - selectedAmong(plan.selection, shown).length;
  const counts = tabCounts(rows);
  const onDefaults = rows.filter((row) => row.reason !== 'matches' && !row.changed).length;
  const { changed } = counts;
  function decide(decided: TrashRow[], decision: TrashDecision) {
    plan.setChoices((previous) => decideRows(previous, decided, decision));
  }
  function decideSelected(decision: TrashDecision) {
    decide(selected, decision);
  }
  const commands = useCommands({
    keep: () => decideSelected('keep'),
    only: () => decideSelected('only'),
    rescue: () => decideSelected('rescue'),
    selectAll: () =>
      plan.setSelection((previous) =>
        selectAll(
          previous,
          shown.map((row) => row.entry.id),
        ),
      ),
    trash: () => decideSelected('trash'),
  });
  function select(row: TrashRow, click: Click) {
    const ids = shown.map((each) => each.entry.id);
    plan.setSelection((previous) => selectRow(previous, row.entry.id, ids, click));
  }
  const folderIds = data.groups.map((group) => group.folderId);
  const allCollapsed = folderIds.every((folderId) => plan.collapsed.has(folderId));
  return (
    // The plan's keys work anywhere in it but its text field.
    <div ref={commands} data-keys="planFocus" className="flex min-h-0 flex-1 flex-col">
      <TrashDefaultsBar
        rows={rows}
        choices={plan.choices}
        onChange={(next) => plan.setChoices(next)}
      />
      {/* Starts where the folders' chevrons do, so the button that collapses them all sits above. */}
      <div className="border-separator flex flex-wrap items-center gap-3 border-y py-2.5 pr-5 pl-3">
        {allCollapsed ? (
          <IconButton label="Expand every folder" onClick={() => plan.setCollapsed(new Set())}>
            <ChevronsUpDown />
          </IconButton>
        ) : (
          <IconButton
            label="Collapse every folder"
            onClick={() => plan.setCollapsed(new Set(folderIds))}
          >
            <ChevronsDownUp />
          </IconButton>
        )}
        <ChoiceToggle
          label="Show"
          choices={TRASH_TABS.filter((tab) => tab === 'all' || counts[tab] > 0).map((tab) => ({
            label: `${TAB_LABELS[tab]} ${counts[tab].toLocaleString()}`,
            value: tab,
          }))}
          value={plan.filter.tab}
          onChange={(tab) => plan.setFilter({ ...plan.filter, tab })}
        />
        <div className="ml-auto w-72">
          <TokenSearchField
            label="Filter rows"
            placeholder="Filter rows"
            query={plan.filter.query}
            onQueryChange={(query) => plan.setFilter({ ...plan.filter, query })}
            tokens={plan.filter.tokens}
            onTokensChange={(tokens) => plan.setFilter({ ...plan.filter, tokens })}
            groups={sheetGroups(rows)}
            empty="No rows to filter by that"
          />
        </div>
      </div>
      {shown.length < rows.length && (
        <p className="text-label-secondary px-5 pt-2 text-sm">
          Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()} rows · the
          others stay decided as they are
        </p>
      )}
      <TrashList
        lines={lines}
        filter={filter}
        selection={plan.selection}
        onSelect={select}
        folderName={folderName}
        onSelectRows={(inside, chosen) =>
          plan.setSelection((previous) =>
            selectRows(
              previous,
              inside.map((row) => row.entry.id),
              chosen,
            ),
          )
        }
        onDecide={decide}
        onCollapse={(folderId) => plan.toggleCollapsed(folderId)}
      />
      <SheetFooter onClose={onClose}>
        {selected.length > 0 ? (
          <>
            <span className="text-sm">
              {selected.length.toLocaleString()} selected
              {hidden > 0 && (
                <span className="text-label-secondary"> · {hidden.toLocaleString()} not shown</span>
              )}
            </span>
            {/* Each counts the rows it decides, as not every row can be decided every way. */}
            {offered(selected).map(({ decision, count }) => (
              <Button key={decision} onClick={() => decideSelected(decision)}>
                {DECISION_LABELS[decision]} {count.toLocaleString()}
              </Button>
            ))}
            <Button onClick={() => plan.setSelection(NO_SELECTION)}>Clear selection</Button>
          </>
        ) : (
          <span className="text-label-secondary text-sm">
            {onDefaults > 0 && `${onDefaults.toLocaleString()} decided by their defaults`}
            {onDefaults > 0 && changed > 0 && ' · '}
            {changed > 0 && `${changed.toLocaleString()} by hand`}
          </span>
        )}
      </SheetFooter>
    </div>
  );
}
