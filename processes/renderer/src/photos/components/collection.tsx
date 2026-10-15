import { Thumbnail } from '#photos/components/thumbnail';
import type { ViewMode } from '#photos/data/entries';
import type { PhotoEntry } from '@app/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useId, useRef, useState } from 'react';

interface CollectionProps {
  entries: PhotoEntry[];
  selectedId: string | null;
  onSelect: (entry: PhotoEntry) => void;
  onOpen: (entry: PhotoEntry) => void;
  onPreview: (entry: PhotoEntry) => void;
  size: number;
  mode?: ViewMode;
}

export function Collection({
  entries,
  selectedId,
  onSelect,
  onOpen,
  onPreview,
  size,
  mode = 'grid'
}: CollectionProps) {
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const horizontal = mode === 'filmstrip';
  const columns = horizontal ? 1 : Math.max(1, Math.floor((width - 32) / (size + 16)));
  const rowSize = horizontal ? size + 12 : size + 48;
  const virtualizer = useVirtualizer({
    count: Math.ceil(entries.length / columns),
    estimateSize: () => rowSize,
    getScrollElement: () => container.current,
    horizontal,
    overscan: 2
  });

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    if (container.current) {
      observer.observe(container.current);
    }
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
      ref={container}
      className={`collection ${horizontal ? 'filmstrip' : 'grid'}`}
      tabIndex={0}
      role="listbox"
      aria-label={horizontal ? 'Photo filmstrip' : 'Folder contents'}
      aria-activedescendant={selectedIndex === -1 ? undefined : `${listId}-${selectedIndex}`}
      onKeyDown={handleKey}
    >
      <div
        className="virtual-content"
        style={
          horizontal
            ? { height: '100%', width: virtualizer.getTotalSize() }
            : { height: virtualizer.getTotalSize() }
        }
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="collection-row"
            style={
              horizontal
                ? { height: '100%', transform: `translateX(${row.start}px)`, width: rowSize }
                : {
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    height: rowSize,
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
                className={`photo-card ${entry.id === selectedId ? 'selected' : ''}`}
                onClick={() => {
                  container.current?.focus();
                  onSelect(entry);
                }}
                onDoubleClick={() => onOpen(entry)}
                title={entry.name}
              >
                <Thumbnail entry={entry} />
                <span className="entry-name">{entry.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
