import { Thumbnail } from '#components/thumbnail';
import { FilteredValues } from '#components/trash/filtered-values';
import { DECISION_LABELS, photoEntryOf, reasonLabel } from '#data/trash';
import type { TrashLine } from '#data/trash-filters';
import type { Selection } from '#data/trash-selection';
import { type Choice, ChoiceToggle, cn } from '@prism/design-system';
import type { PhotoFilter, TrashDecision, TrashRow } from '@prism/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight } from 'lucide-react';
import { type MouseEvent, useRef } from 'react';

const ROW_HEIGHT = 52;
const HEADING_HEIGHT = 34;

/** How a click chooses rows: alone, or with Command or Shift as well. */
export interface Click {
  extend: boolean;
  toggle: boolean;
}

function clickOf(event: MouseEvent): Click {
  return { extend: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
}

function choicesOf(options: TrashDecision[]): Choice<TrashDecision>[] {
  return options.map((value) => ({
    label: DECISION_LABELS[value],
    tone: value === 'trash' ? 'danger' : 'plain',
    value,
  }));
}

/** What `rows` are decided as, each decision with how many: `3 Trash · 1 Only matches`. */
function decidedAs(rows: TrashRow[]): string {
  return (['keep', 'only', 'rescue', 'trash'] as const)
    .flatMap((decision) => {
      const count = rows.filter((row) => row.decision === decision).length;
      return count > 0 ? [`${count.toLocaleString()} ${DECISION_LABELS[decision]}`] : [];
    })
    .join(' · ');
}

function Stars({ stars }: { stars: number | undefined }) {
  return stars === undefined ? null : (
    <span className="text-rating shrink-0 text-sm" aria-label={`${stars} stars`}>
      {'★'.repeat(stars)}
    </span>
  );
}

/**
 * A folder's heading over the rows of what is inside it. It selects them, all at once, rather
 * than deciding them, as the folder's own decision is on its row under its parent: the action
 * bar decides the selection, saying what each decision would change.
 */
function FolderHeading({
  line,
  name,
  selected,
  onCollapse,
  onSelect,
}: {
  line: Extract<TrashLine, { type: 'folder' }>;
  name: string;
  /** How many of its rows are selected. */
  selected: number;
  onCollapse: () => void;
  onSelect: (selected: boolean) => void;
}) {
  const all = selected === line.rows.length;
  return (
    // The whole heading collapses and expands, as a disclosure's does; its button is the
    // keyboard's way, and its checkbox selects.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      onClick={onCollapse}
      className="bg-surface border-separator flex h-full cursor-default items-center gap-2 border-b pr-3 pl-4 select-none"
    >
      <input
        type="checkbox"
        checked={all}
        ref={(element) => {
          if (element) {
            element.indeterminate = selected > 0 && !all;
          }
        }}
        aria-label={`Select every row inside ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(!all);
        }}
        onChange={() => null}
        className="accent-accent shrink-0"
      />
      <button
        type="button"
        aria-expanded={!line.collapsed}
        aria-label={`${line.collapsed ? 'Show' : 'Hide'} the rows inside ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          onCollapse();
        }}
        className="text-label-secondary hover:text-label icon-sm rounded-control flex size-6 items-center justify-center"
      >
        <ChevronRight className={cn('transition-transform', !line.collapsed && 'rotate-90')} />
      </button>
      <span className="truncate text-sm" title={name}>
        <span className="text-label-secondary">Inside </span>
        <span className="font-semibold">{name}</span>
      </span>
      <span className="text-label-tertiary shrink-0 text-sm">
        {line.rows.length.toLocaleString()} {line.rows.length === 1 ? 'row' : 'rows'}
      </span>
      <span className="text-label-secondary ml-auto shrink-0 text-sm">{decidedAs(line.rows)}</span>
    </div>
  );
}

function Row({
  row,
  filter,
  selected,
  onSelect,
  onDecide,
}: {
  row: TrashRow;
  filter: PhotoFilter;
  selected: boolean;
  onSelect: (click: Click) => void;
  onDecide: (decision: TrashDecision) => void;
}) {
  const { entry } = row;
  const details = [
    reasonLabel(row),
    row.decision === 'rescue' && row.rescueTo !== undefined
      ? `moves to ${row.rescueTo === '.' ? 'the top folder' : row.rescueTo}`
      : null,
    row.attachments.length > 0 &&
      `with ${row.attachments.length} ${row.attachments.length === 1 ? 'sidecar' : 'sidecars'}`,
  ].filter(Boolean);
  return (
    // The row selects as Finder's do; its checkbox and its decision are keyboard-reachable.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-selected={selected || undefined}
      // Shift and Command pick rows rather than extend a text selection; dragging still selects text.
      onMouseDown={(event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('[data-decision]')) {
          onSelect(clickOf(event));
        }
      }}
      className="border-separator data-selected:bg-fill-focused flex h-full items-center gap-3 border-b pr-3 pl-4"
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${entry.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ extend: event.shiftKey, toggle: true });
        }}
        onChange={() => null}
        className="accent-accent shrink-0"
      />
      <Thumbnail entry={photoEntryOf(entry)} size="icon" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium" title={entry.name}>
            {entry.name}
          </span>
          {/* Ratings decide conflicts, so they show whatever the filter narrows by. */}
          {filter.rating.length === 0 && <Stars stars={entry.rating} />}
          <FilteredValues entry={entry} filter={filter} />
          {row.changed && (
            <span
              className="bg-accent size-1.5 shrink-0 rounded-full"
              aria-label="Decided by hand"
            />
          )}
        </span>
        <span className="text-label-secondary truncate text-sm">{details.join(' · ')}</span>
      </span>
      {/* Deciding leaves the selection as it is. */}
      <span data-decision className="contents">
        <ChoiceToggle
          label={`What becomes of ${entry.name}`}
          choices={choicesOf(row.options)}
          value={row.decision}
          onChange={onDecide}
        />
      </span>
    </div>
  );
}

/**
 * The plan's rows under their folders' headings, as many as there are, each with its decision
 * one click away. A folder's heading decides all its rows shown at once, and hides them.
 */
export function TrashList({
  lines,
  filter,
  folderName,
  selection,
  onSelect,
  onSelectRows,
  onDecide,
  onCollapse,
}: {
  lines: TrashLine[];
  /** The name of the folder the plan is of, which the heading of what is directly in it says. */
  folderName: string;
  /** The filter the plan is of, whose fields each row shows its values of. */
  filter: PhotoFilter;
  selection: Selection;
  onSelect: (row: TrashRow, click: Click) => void;
  onSelectRows: (rows: TrashRow[], selected: boolean) => void;
  onDecide: (rows: TrashRow[], decision: TrashDecision) => void;
  onCollapse: (folderId: string) => void;
}) {
  // TanStack Virtual's virtualizer changes in place, so React Compiler would keep showing
  // the rows it first rendered.
  'use no memo';
  const container = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    estimateSize: (index) => (lines[index]?.type === 'folder' ? HEADING_HEIGHT : ROW_HEIGHT),
    getItemKey: (index) => {
      const line = lines[index];
      return line?.type === 'folder' ? `folder:${line.folderId}` : (line?.row.entry.id ?? index);
    },
    getScrollElement: () => container.current,
    overscan: 10,
  });
  return (
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto [--folder-cover:--spacing(8)]">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index];
          if (!line) {
            return null;
          }
          return (
            <div
              key={item.key}
              className="absolute inset-x-0 top-0"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {line.type === 'folder' ? (
                <FolderHeading
                  line={line}
                  name={line.folderId === '.' ? folderName : line.folderId}
                  selected={line.rows.filter((row) => selection.ids.has(row.entry.id)).length}
                  onCollapse={() => onCollapse(line.folderId)}
                  onSelect={(selected) => onSelectRows(line.rows, selected)}
                />
              ) : (
                <Row
                  row={line.row}
                  filter={filter}
                  selected={selection.ids.has(line.row.entry.id)}
                  onSelect={(click) => onSelect(line.row, click)}
                  onDecide={(decision) => onDecide([line.row], decision)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
