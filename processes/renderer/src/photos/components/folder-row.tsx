import { CachedValue } from '#photos/components/cached-value';
import { useEntryMenu } from '#photos/components/entry-menu';
import type { FolderTrail } from '#photos/components/folder-tree';
import { Thumbnail } from '#photos/components/thumbnail';
import { useLibrary } from '#photos/hooks/use-library';
import { cn, SidebarRow } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface TreeRow {
  entry: PhotoEntry;
  trail: FolderTrail;
  /** Where it falls among its siblings, counting from 1, since only some rows are rendered. */
  position: number;
  siblings: number;
}

export function FolderRow({
  id,
  row,
  active,
  selected,
  expanded,
  expandable,
  onToggle,
  onNavigate,
  top
}: {
  id: string;
  row: TreeRow;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
  onNavigate: (trail: FolderTrail) => void;
  top: number;
}) {
  const library = useLibrary();
  const showEntryMenu = useEntryMenu();
  return (
    <CachedValue
      cached={library.peekSummary(row.entry.id)}
      read={() => library.summary(row.entry.id)}
      generation={library.generation}
    >
      {(summary) => {
        const canExpand = summary?.hasSubfolders ?? expandable;
        return (
          <SidebarRow
            id={id}
            role="treeitem"
            active={active}
            selected={selected}
            aria-label={row.entry.name}
            aria-expanded={canExpand ? expanded : undefined}
            aria-level={row.trail.length}
            aria-posinset={row.position}
            aria-setsize={row.siblings}
            className="absolute inset-x-2.5 top-0"
            onContextMenu={(event) => showEntryMenu(event, row.entry)}
            style={{
              paddingLeft: 4 + Math.min(row.trail.length - 1, 8) * 14,
              transform: `translateY(${top}px)`
            }}
          >
            {/* The tree is one tab stop; arrow keys move between rows, and expand and collapse
                them, which the row tells screen readers. So the disclosure triangle is only
                for the pointer, and stays out of the row's name. */}
            <span
              aria-hidden
              className={cn(
                'flex h-7 w-4 shrink-0 items-center justify-center text-label-tertiary',
                canExpand && 'cursor-pointer'
              )}
              onClick={canExpand ? onToggle : undefined}
            >
              {canExpand && (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
            </span>
            <button
              type="button"
              tabIndex={-1}
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => onNavigate(row.trail)}
              title={row.entry.name}
            >
              <Thumbnail entry={row.entry} size="icon" />
              <span className="truncate">{row.entry.name}</span>
            </button>
          </SidebarRow>
        );
      }}
    </CachedValue>
  );
}
