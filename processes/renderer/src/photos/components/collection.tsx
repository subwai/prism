import { Thumbnail } from '#photos/components/thumbnail';
import type { ViewMode } from '#photos/data/entries';
import { cn } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Keep in sync with the row's gap-3/px-2 and the grid caption's h-6 below.
const GAP = 12,
  ROW_PADDING = 16,
  CAPTION_HEIGHT = 24;

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
  autoFocus
}: CollectionProps) {
  const listId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  // Content that loads into an already open dialog misses its initial focus, so take it here.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      container.current = node;
      if (autoFocus) {
        node?.focus();
      }
    },
    [autoFocus]
  );
  const [width, setWidth] = useState(0);
  const horizontal = mode === 'filmstrip';
  const columns = horizontal
    ? 1
    : Math.max(1, Math.floor((width - ROW_PADDING + GAP) / (size + GAP)));
  // Cards stretch to fill the row, so square thumbnails are as tall as a card is wide.
  const cardWidth = horizontal ? size : (width - ROW_PADDING - GAP * (columns - 1)) / columns;
  const rowSize = Math.max(0, cardWidth) + GAP + (horizontal ? 0 : CAPTION_HEIGHT);
  const virtualizer = useVirtualizer({
    count: Math.ceil(entries.length / columns),
    estimateSize: () => rowSize,
    getScrollElement: () => container.current,
    horizontal,
    overscan: 2,
    // The toolbar already names the folder, so the grid starts just below it.
    paddingEnd: horizontal ? 0 : 16,
    paddingStart: horizontal ? 0 : 16,
    scrollPaddingStart: horizontal ? 0 : 16
  });

  // Measured while committing, so the first frame (and a crossfade's snapshot of it) already
  // has its columns; waiting for the observer would paint one frame at zero width. The sizer
  // spans the scroller's content box.
  const measure = useCallback((node: HTMLDivElement) => {
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowSize, columns]);
  const selectedIndex = entries.findIndex((entry) => entry.id === selectedId);
  useEffect(() => {
    if (selectedIndex !== -1) {
      virtualizer.scrollToIndex(Math.floor(selectedIndex / columns), { align: 'auto' });
    }
  }, [virtualizer, selectedIndex, columns]);

  function handleKey(event: React.KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: columns,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      End: entries.length,
      Home: -entries.length
    };
    if (event.key in moves && entries.length > 0) {
      event.preventDefault();
      const next = Math.max(
        0,
        Math.min(
          entries.length - 1,
          selectedIndex === -1 ? 0 : selectedIndex + (moves[event.key] ?? 0)
        )
      );
      const entry = entries[next];
      if (entry) {
        onSelect(entry);
      }
    } else if (selectedIndex !== -1 && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const entry = entries[selectedIndex];
      if (entry) {
        (event.key === 'Enter' ? onOpen : onPreview)(entry);
      }
    }
  }

  return (
    <div
      ref={attach}
      className={cn(
        'relative min-h-0 flex-1 overflow-auto contain-strict focus-visible:outline-none',
        // Filmstrip: 76px cards without captions, plus top padding and the scrollbar.
        // Grid: reserve the scrollbar's width so filtering to a short list keeps card sizes.
        horizontal
          ? 'flex-none basis-24 border-t border-separator px-1.5 pt-1.75'
          : 'scrollbar-gutter-stable px-4.5'
      )}
      tabIndex={0}
      data-autofocus={autoFocus || undefined}
      role="listbox"
      aria-label={horizontal ? 'Photo filmstrip' : 'Folder contents'}
      aria-activedescendant={selectedIndex === -1 ? undefined : `${listId}-${selectedIndex}`}
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
              horizontal ? 'px-1.5' : 'px-2'
            )}
            style={
              horizontal
                ? { height: '100%', transform: `translateX(${row.start}px)`, width: rowSize }
                : {
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    height: rowSize - GAP,
                    transform: `translateY(${row.start}px)`
                  }
            }
          >
            {entries.slice(row.index * columns, (row.index + 1) * columns).map((entry, index) => (
              <div
                key={entry.id}
                id={`${listId}-${row.index * columns + index}`}
                role="option"
                aria-selected={entry.id === selectedId}
                className="group flex min-w-0 cursor-default flex-col rounded-card p-1.5 hover:bg-fill aria-selected:bg-fill-strong"
                onClick={() => {
                  container.current?.focus();
                  onSelect(entry);
                }}
                onDoubleClick={() => onOpen(entry)}
                title={entry.name}
              >
                <Thumbnail entry={entry} />
                {!horizontal && (
                  <span className="h-6 shrink-0 truncate px-0.5 pt-1.75 text-center text-footnote text-label-secondary group-aria-selected:text-label">
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
