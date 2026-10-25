import { useEntryMenu } from '#photos/components/entry-menu';
import { QueryValue } from '#photos/components/query-value';
import { Thumbnail } from '#photos/components/thumbnail';
import { useLibrary } from '#photos/hooks/use-library';
import type { Slide } from '#photos/hooks/use-tree-motion';
import type { TreeRow } from '#photos/hooks/use-tree-rows';
import { cn, SidebarRow } from '@prism/design-system';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';

export function FolderRow({
  id,
  row,
  active,
  selected,
  expanded,
  expandable,
  onToggle,
  onNavigate,
  top,
  slide,
  leaving = false
}: {
  id?: string;
  row: TreeRow;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  top: number;
  /** How it slides out from under the folder above it as it appears, or back as it leaves. */
  slide?: Slide;
  /** Hidden by closing a folder above it, so it slides away from `top`. */
  leaving?: boolean;
}) {
  const library = useLibrary();
  const showEntryMenu = useEntryMenu();
  return (
    <QueryValue query={library.summaryQuery(row.entry.id)}>
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
            aria-level={row.depth + 1}
            aria-posinset={row.position}
            aria-setsize={row.siblings}
            // Rows only move while the tree opens or closes a folder, so rows that appear for
            // any other reason, such as scrolling, stay put. Rows the folder shows or hides
            // slide in step with the rows below, clipped where they pass under the folder.
            className={cn(
              'absolute inset-x-2.5 top-0 h-[calc(var(--folder-cover)+--spacing(2.5))] duration-200 ease-swift motion-reduce:transition-none',
              slide
                ? 'transition-[--slide]'
                : 'translate-y-(--top) transition-none group-data-moving/tree:transition-[translate]',
              slide && (leaving ? '[--slide:1] starting:[--slide:0]' : 'starting:[--slide:1]')
            )}
            onContextMenu={(event) => showEntryMenu(event, row.entry)}
            style={
              {
                '--top': `${top}px`,
                clipPath:
                  slide &&
                  `inset(max(0px, ${slide.height}px * var(--slide) - ${slide.depth}px) 0 0)`,
                paddingLeft: 4 + Math.min(row.depth, 8) * 14,
                translate: slide && `0 calc(${top}px - ${slide.shift}px * var(--slide))`
              } as CSSProperties
            }
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
              onClick={onNavigate}
              title={row.entry.name}
            >
              <Thumbnail entry={row.entry} size="icon" />
              <span className="truncate">{row.entry.name}</span>
            </button>
          </SidebarRow>
        );
      }}
    </QueryValue>
  );
}
