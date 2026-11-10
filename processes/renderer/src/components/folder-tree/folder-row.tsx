import { useEntryMenu } from '#components/entry-menu';
import type { Slide } from '#components/folder-tree/use-tree-motion';
import type { TreeRow } from '#components/folder-tree/use-tree-rows';
import { Thumbnail } from '#components/thumbnail';
import { useLibrary } from '#hooks/use-library';
import { cn, SidebarDisclosure, SidebarRow } from '@prism/design-system';
import { useQuery } from '@tanstack/react-query';
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
  leaving = false,
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
  // Read without suspending, so the row and its cover change as soon as the folder is known,
  // rather than up to 300 ms later, as React holds back a boundary's content after its fallback.
  const { data: summary } = useQuery(library.summaryQuery(row.entry.id));
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
        slide && (leaving ? '[--slide:1] starting:[--slide:0]' : 'starting:[--slide:1]'),
      )}
      onContextMenu={(event) => showEntryMenu(event, row.entry)}
      style={
        {
          '--top': `${top}px`,
          clipPath:
            slide && `inset(max(0px, ${slide.height}px * var(--slide) - ${slide.depth}px) 0 0)`,
          paddingLeft: 4 + Math.min(row.depth, 8) * 14,
          translate: slide && `0 calc(${top}px - ${slide.shift}px * var(--slide))`,
        } as CSSProperties
      }
    >
      <SidebarDisclosure expanded={expanded} onToggle={canExpand ? onToggle : undefined} />
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
}
