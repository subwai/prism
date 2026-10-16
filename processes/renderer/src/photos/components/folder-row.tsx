import { CachedValue } from '#photos/components/cached-value';
import type { FolderTrail } from '#photos/components/folder-tree';
import { Thumbnail } from '#photos/components/thumbnail';
import { useLibrary } from '#photos/hooks/use-library';
import { SidebarRow } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface TreeRow {
  entry: PhotoEntry;
  trail: FolderTrail;
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
            ariaExpanded={canExpand ? expanded : undefined}
            ariaLevel={row.trail.length}
            className="absolute inset-x-2.5 top-0"
            style={{
              paddingLeft: 4 + Math.min(row.trail.length - 1, 8) * 14,
              transform: `translateY(${top}px)`
            }}
          >
            {/* The tree is one tab stop; arrow keys move between rows. */}
            <button
              type="button"
              tabIndex={-1}
              className="flex h-7 w-4 shrink-0 items-center justify-center text-label-tertiary"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.entry.name}`}
              disabled={!canExpand}
              onClick={onToggle}
            >
              {canExpand && (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
            </button>
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
