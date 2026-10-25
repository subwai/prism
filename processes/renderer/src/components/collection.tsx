import { useEntryMenu, useEntryMenuBelow, useRenameEntry } from '#components/entry-menu';
import { Thumbnail } from '#components/thumbnail';
import { GAP, useGridLayout } from '#components/use-grid-layout';
import type { ViewMode } from '#data/entries';
import { useCommands } from '#keyboard/commands';
import { commandFor } from '#keyboard/keymap';
import { cn, mergeRefs } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';

/** What screen readers say an entry is, besides its name; photos go without saying. */
const KINDS: Partial<Record<PhotoEntry['kind'], string>> = { directory: 'Folder', video: 'Video' };

interface CollectionProps {
  entries: PhotoEntry[];
  selectedId: string | null;
  onSelect: (entry: PhotoEntry) => void;
  onOpen: (entry: PhotoEntry) => void;
  onPreview: (entry: PhotoEntry) => void;
  size: number;
  mode?: ViewMode;
  /** Takes focus when it opens inside a dialog. */
  autoFocus?: boolean;
}

export function Collection({
  entries,
  selectedId,
  onSelect,
  onOpen,
  onPreview,
  size,
  mode = 'grid',
  autoFocus,
}: CollectionProps) {
  const listId = useId();
  const showEntryMenu = useEntryMenu();
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  const container = useRef<HTMLDivElement | null>(null);
  // Content that loads into an already open dialog misses its initial focus, so take it here.
  // So does a view that replaced the one with focus, as going to another folder from the
  // toolbar does: the control that had it went with the old view, leaving focus nowhere.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      container.current = node;
      if (autoFocus || document.activeElement === document.body) {
        node?.focus();
      }
    },
    [autoFocus],
  );
  const horizontal = mode === 'filmstrip';
  const { columns, measure, rowSize, virtualizer } = useGridLayout(
    entries.length,
    size,
    horizontal,
    container,
  );
  const selectedIndex = entries.findIndex((entry) => entry.id === selectedId);
  const optionId = (index: number) => `${listId}-${index}`;
  // Commands act on the selection while focus is in this list.
  const commands = useCommands({
    // Opens the selection's menu below it, as a right-click on it would, scrolling it into
    // view first: scrolling leaves the selection where it was, possibly out of sight.
    contextMenu() {
      const entry = entries[selectedIndex];
      if (entry) {
        virtualizer.scrollToIndex(Math.floor(selectedIndex / columns), { align: 'auto' });
        showEntryMenuBelow(entry, () => container.current?.querySelector('[aria-selected="true"]'));
      }
    },
    rename() {
      const entry = entries[selectedIndex];
      if (entry) {
        rename(entry);
      }
    },
  });
  const ref = useMemo(() => mergeRefs(attach, commands), [attach, commands]);
  useEffect(() => {
    if (selectedIndex !== -1) {
      virtualizer.scrollToIndex(Math.floor(selectedIndex / columns), { align: 'auto' });
    }
  }, [virtualizer, selectedIndex, columns]);

  function handleKey(event: React.KeyboardEvent) {
    const command = commandFor(event.nativeEvent);
    const entry = entries[selectedIndex];
    if (command === 'preview' && entry) {
      event.preventDefault();
      onPreview(entry);
      return;
    }
    // Keys the keymap binds here are its own, such as Left and Right while a video in the
    // filmstrip is being watched; the rest move the selection or open it.
    if (command || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: columns,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      End: entries.length,
      Home: -entries.length,
    };
    if (event.key in moves && entries.length > 0) {
      event.preventDefault();
      const next = Math.max(
        0,
        Math.min(
          entries.length - 1,
          selectedIndex === -1 ? 0 : selectedIndex + (moves[event.key] ?? 0),
        ),
      );
      const target = entries[next];
      if (target) {
        onSelect(target);
      }
    } else if (event.key === 'Enter' && entry) {
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
        // Filmstrip: 76px cards without captions, plus top padding and the scrollbar.
        // Grid: reserve the scrollbar's width so filtering to a short list keeps card sizes.
        horizontal
          ? 'flex-none basis-24 border-t border-separator px-1.5 pt-1.75'
          : 'scrollbar-gutter-stable px-4.5',
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
        style={
          horizontal
            ? { height: '100%', width: virtualizer.getTotalSize() }
            : { height: virtualizer.getTotalSize() }
        }
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className={cn(
              'absolute top-0 left-0 grid w-full items-start gap-3',
              horizontal ? 'px-1.5' : 'px-2',
            )}
            style={
              horizontal
                ? { height: '100%', transform: `translateX(${row.start}px)`, width: rowSize }
                : {
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    height: rowSize - GAP,
                    transform: `translateY(${row.start}px)`,
                  }
            }
          >
            {entries.slice(row.index * columns, (row.index + 1) * columns).map((entry, index) => (
              // The listbox takes focus and the keys, and points at its options with
              // aria-activedescendant, so the options themselves are only clicked.
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
              <div
                key={entry.id}
                id={optionId(row.index * columns + index)}
                role="option"
                aria-selected={entry.id === selectedId}
                // Named outright, so the card's captions are not read as part of its name. Only
                // some options are rendered, so each says where it falls in the whole list.
                aria-label={entry.name}
                // oxlint-disable-next-line jsx-a11y/role-supports-aria-props -- ARIA 1.3 allows it on any role; the rule predates it.
                aria-description={KINDS[entry.kind]}
                aria-setsize={entries.length}
                aria-posinset={row.index * columns + index + 1}
                // The selection fills in the accent while the list has keyboard focus.
                className="group rounded-card hover:bg-fill aria-selected:bg-fill-strong aria-selected:in-focus-visible:bg-fill-focused flex min-w-0 cursor-default flex-col p-1.5"
                onClick={() => {
                  container.current?.focus();
                  onSelect(entry);
                }}
                onDoubleClick={() => onOpen(entry)}
                // Selects what it opens a menu for, as Finder does.
                onContextMenu={(event) => {
                  container.current?.focus();
                  onSelect(entry);
                  showEntryMenu(event, entry);
                }}
                title={entry.name}
              >
                <Thumbnail entry={entry} />
                {!horizontal && (
                  <span className="text-label-secondary group-aria-selected:text-label h-6 shrink-0 truncate px-0.5 pt-1.75 text-center text-sm">
                    {entry.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
