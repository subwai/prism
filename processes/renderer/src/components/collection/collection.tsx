import { indexAfterKey } from '#components/collection/selection-moves';
import { GAP, useGridLayout } from '#components/collection/use-grid-layout';
import { useEntryMenu, useEntryMenuBelow, useRenameEntry } from '#components/entry-menu';
import { Thumbnail } from '#components/thumbnail';
import { shownEntry } from '#data/edits/pending-edits';
import { followRenames } from '#data/edits/renames';
import type { ViewMode } from '#data/entries';
import type { GalleryView } from '#data/views/gallery-view';
import { useViewEntries, useViewIndex, useViewState } from '#hooks/use-gallery-view';
import { useLibrary, usePendingEdits } from '#hooks/use-library';
import { useRating } from '#hooks/use-rating';
import { useCommands } from '#keyboard/commands';
import { commandFor } from '#keyboard/keymap';
import { cn, GridCell, mergeRefs, Placeholder } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';

/** What screen readers say an entry is, besides its name; photos go without saying. */
const SPOKEN_KINDS: Partial<Record<PhotoEntry['kind'], string>> = {
  directory: 'Folder',
  video: 'Video',
};

interface CollectionProps {
  /** What it shows, of which only the rows on screen are read. */
  view: GalleryView;
  selectedId: string | null;
  onSelect: (entry: PhotoEntry) => void;
  /** Left out where nothing opens, as in the filmstrip, whose viewer already shows the selection. */
  onOpen?: (entry: PhotoEntry) => void;
  /** Left out where there is no preview, which only the grid has. */
  onPreview?: (entry: PhotoEntry) => void;
  /** Previews a folder's cover. Left out where there is no preview of one. */
  onPreviewCover?: (folder: PhotoEntry) => void;
  size: number;
  mode?: ViewMode;
  /** Takes focus when it opens inside a dialog. */
  autoFocus?: boolean;
}

export function Collection({
  view,
  selectedId,
  onSelect,
  onOpen,
  onPreview,
  onPreviewCover,
  size,
  mode = 'grid',
  autoFocus,
}: CollectionProps) {
  // TanStack Virtual's virtualizer changes in place, so React Compiler would keep showing
  // the rows it first rendered.
  'use no memo';
  const listId = useId();
  const showEntryMenu = useEntryMenu();
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  const container = useRef<HTMLDivElement | null>(null);
  // Content that loads into an already open dialog misses its initial focus, so take it here.
  // So does a view that replaced the one with focus, as going to another folder from the
  // toolbar does: the control that had it went with the old view, leaving focus nowhere.
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      container.current = node;
      if (autoFocus || document.activeElement === document.body) {
        node?.focus();
      }
    },
    [autoFocus],
  );
  const horizontal = mode === 'filmstrip';
  const { count } = useViewState(view);
  // Tells the worker which rows are on screen, so it makes their thumbnails first, and then
  // those of the rows around them in a small enough view. Once this list unmounts, it tells the
  // worker the view is gone.
  const { screenContents } = useLibrary();
  const { viewId } = view;
  const hideRowsWhenGone = useCallback(
    () => () => screenContents.hideRows(viewId),
    [screenContents, viewId],
  );
  const {
    anchor,
    columns,
    measure,
    rowSize,
    scrollToRow,
    shift,
    size: scrolled,
    virtualizer,
    wheel,
  } = useGridLayout({
    count,
    horizontal,
    onRowsOnScreen: (start, end) => screenContents.showRows(viewId, start, end),
    scroller: container,
    size,
  });
  const rows = virtualizer.getVirtualItems();
  // The virtualizer renders a run of rows, all `rowSize` apart.
  const [first] = rows;
  const entryAt = useViewEntries(
    view,
    (first?.index ?? 0) * columns,
    ((rows.at(-1)?.index ?? -1) + 1) * columns,
  );
  const selectedIndex = useViewIndex(view, selectedId);
  const edits = usePendingEdits();
  const selectedMoved = selectedId === null ? null : followRenames(edits.renames, selectedId);
  const selection = () => {
    const entry = entryAt(selectedIndex) ?? view.peek(selectedIndex);
    return entry && shownEntry(edits, entry);
  };
  const rating = useRating(selection());
  const optionId = (index: number) => `${listId}-${index}`;
  /** Selects the entry at `index`, once its row is read if it has not been. */
  function select(index: number) {
    const loaded = view.peek(index);
    const chosen = loaded ? Promise.resolve(loaded) : view.entry(index);
    chosen
      .then((entry) => {
        if (entry) {
          view.rememberIndex(entry.id, index);
          onSelect(entry);
        }
      })
      .catch(() => null);
  }
  // Commands act on the selection while focus is in this list.
  const commands = useCommands({
    ...rating.commands,
    // Opens the selection's menu below it, as a right-click on it would, scrolling it into
    // view first: scrolling leaves the selection where it was, possibly out of sight.
    contextMenu() {
      const entry = selection();
      if (entry) {
        scrollToRow(Math.floor(selectedIndex / columns));
        showEntryMenuBelow(entry, () => container.current?.querySelector('[aria-selected="true"]'));
      }
    },
    rename() {
      const entry = selection();
      if (entry) {
        rename(entry);
      }
    },
  });
  const ref = useMemo(
    () => mergeRefs(attachList, commands, anchor, wheel, hideRowsWhenGone),
    [attachList, commands, anchor, wheel, hideRowsWhenGone],
  );
  useEffect(() => {
    if (selectedIndex !== -1) {
      scrollToRow(Math.floor(selectedIndex / columns));
    }
  }, [scrollToRow, selectedIndex, columns]);

  function handleKey(event: React.KeyboardEvent) {
    const command = commandFor(event.nativeEvent);
    const entry = selection();
    if (command === 'preview' && onPreview && entry) {
      event.preventDefault();
      onPreview(entry);
      return;
    }
    if (command === 'previewCover' && onPreviewCover && entry?.kind === 'directory') {
      event.preventDefault();
      onPreviewCover(entry);
      return;
    }
    // Keys the keymap binds here are its own, such as Shift-Left and Shift-Right while the
    // filmstrip shows a video; the rest move the selection or open it.
    if (command || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const next = indexAfterKey({ columns, count, key: event.key, selectedIndex });
    if (next !== null) {
      event.preventDefault();
      select(next);
    } else if (event.key === 'Enter' && onOpen && entry) {
      event.preventDefault();
      onOpen(entry);
    }
  }

  return (
    <div
      ref={ref}
      data-keys="listFocus"
      className={cn(
        'relative min-h-0 flex-1 overflow-auto contain-strict focus-visible:outline-none',
        // Filmstrip: cards without captions, in a strip whose height the filmstrip sets.
        // Grid: reserve the scrollbar's width so filtering to a short list keeps card sizes.
        horizontal ? 'px-1.5 pt-1.75' : 'scrollbar-gutter-stable px-4.5',
      )}
      tabIndex={0}
      data-autofocus={autoFocus || undefined}
      role="listbox"
      aria-label={horizontal ? 'Photo filmstrip' : 'Folder contents'}
      aria-orientation={horizontal ? 'horizontal' : undefined}
      aria-activedescendant={selectedIndex === -1 ? undefined : optionId(selectedIndex)}
      onKeyDown={handleKey}
    >
      <div
        ref={measure}
        className="relative w-full"
        style={horizontal ? { height: '100%', width: scrolled } : { height: scrolled }}
      >
        {/*
          One container for the rows on screen, rather than one each: a card that moves to
          another row as the view's order changes stays the same element, keyed by its entry,
          instead of mounting again and loading its thumbnail anew.
        */}
        {first && (
          <div
            className={cn(
              'absolute top-0 left-0 grid items-start gap-3',
              horizontal ? 'h-full grid-flow-col px-1.5' : 'w-full px-2',
            )}
            style={
              horizontal
                ? {
                    gridAutoColumns: rowSize - GAP,
                    transform: `translateX(${first.start - shift}px)`,
                  }
                : {
                    gridAutoRows: rowSize - GAP,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    transform: `translateY(${first.start - shift}px)`,
                  }
            }
          >
            {Array.from(
              { length: Math.min(rows.length * columns, count - first.index * columns) },
              (_cell, offset) => first.index * columns + offset,
            ).map((index) => {
              const entry = entryAt(index);
              // Rows not read yet hold their place until they are.
              if (!entry) {
                return (
                  <div key={`unread-${index}`} className="p-1.5">
                    <Placeholder shape="square" />
                  </div>
                );
              }
              return (
                <GridCell
                  key={entry.id}
                  id={optionId(index)}
                  role="option"
                  // Found under its new name if it was renamed in this window since it was chosen.
                  aria-selected={entry.id === selectedId || entry.id === selectedMoved}
                  // Named outright, so the card's captions are not read as part of its name. Only
                  // some options are rendered, so each says where it falls in the whole list.
                  aria-label={entry.name}
                  // oxlint-disable-next-line jsx-a11y/role-supports-aria-props -- ARIA 1.3 allows it on any role; the rule predates it.
                  aria-description={SPOKEN_KINDS[entry.kind]}
                  aria-setsize={count}
                  aria-posinset={index + 1}
                  // Selects on press rather than release, so a rating key hit before the
                  // button comes up lands on the card being chosen.
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    container.current?.focus();
                    view.rememberIndex(entry.id, index);
                    onSelect(entry);
                  }}
                  onDoubleClick={() => onOpen?.(entry)}
                  // Selects what it opens a menu for, as Finder does.
                  onContextMenu={(event) => {
                    container.current?.focus();
                    view.rememberIndex(entry.id, index);
                    onSelect(entry);
                    showEntryMenu(event, entry);
                  }}
                  title={entry.name}
                >
                  <Thumbnail entry={entry} named={!horizontal} />
                </GridCell>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
