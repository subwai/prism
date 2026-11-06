import { useEntryMenuBelow, useRenameEntry } from '#components/entry-menu';
import { FolderRow } from '#components/folder-tree/folder-row';
import { COVER_SIZE, FolderTreeFooter } from '#components/folder-tree/folder-tree-footer';
import { OpenFolderButton } from '#components/folder-tree/open-folder-button';
import { useTreeCursor } from '#components/folder-tree/use-tree-cursor';
import { type Slide, useTreeMotion } from '#components/folder-tree/use-tree-motion';
import { trailOf, type TreeRow, useTreeRows } from '#components/folder-tree/use-tree-rows';
import { subfolders } from '#data/directory-scan';
import type { ViewMode } from '#data/entries';
import type { FolderTrail } from '#data/library';
import { useLibrary } from '#hooks/use-library';
import { useViewParams } from '#hooks/use-view-params';
import { useCommands } from '#keyboard/commands';
import { commandFor } from '#keyboard/keymap';
import {
  Badge,
  IconButton,
  mergeRefs,
  Sidebar,
  SidebarHeading,
  SidebarTitleBar,
} from '@prism/design-system';
import type { PhotoRoot } from '@prism/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';

/** Each row is as tall as its cover, plus its padding and the gap to the next row. */
const ROW_PADDING = 12;

const LOCATION_LABELS = { local: 'Local', network: 'Network' } as const;

export function FolderTree({
  root,
  trail,
  onNavigate,
  mode,
}: {
  root: PhotoRoot;
  trail: FolderTrail;
  onNavigate: (trail: FolderTrail) => void;
  mode: ViewMode;
}) {
  const library = useLibrary();
  const [coverSize, setCoverSize] = useState(COVER_SIZE.default);
  const rowHeight = coverSize + ROW_PADDING;
  const container = useRef<HTMLDivElement>(null);
  const treeId = useId();
  const current = trail.at(-1)?.id;
  const { openPreview } = useViewParams();
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  const tree = useTreeRows(root, trail);
  const { rows, indexOf, expanded } = tree;
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => container.current,
    overscan: 4,
  });
  const motion = useTreeMotion(rows, rowHeight, virtualizer);
  const { active, select } = useTreeCursor(trail, indexOf);
  function expandable(id: string) {
    const state = library.peekDirectory(id);
    return !state || state.error !== null || subfolders(state).length > 0;
  }
  function moveTo(index: number) {
    const row = rows[index];
    if (row) {
      select(row.entry.id);
      virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  }
  // The WAI-ARIA tree pattern, plus Enter to open and, beside the grid, Space to peek, as in it.
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const row = rows[active];
    if (!row || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const { id } = row.entry;
    const open = expanded(id);
    const canExpand = library.peekSummary(id)?.hasSubfolders ?? expandable(id);
    const parent = indexOf(row.parent?.entry.id);
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(active + 1),
      ArrowLeft: () => (open && canExpand ? toggle(id) : moveTo(parent)),
      ArrowRight: () => {
        if (!open && canExpand) {
          toggle(id);
        } else if (open) {
          moveTo(active + 1);
        }
      },
      ArrowUp: () => moveTo(active - 1),
      End: () => moveTo(rows.length - 1),
      Enter: () => onNavigate(trailOf(row)),
      Home: () => moveTo(0),
    };
    const peek = mode === 'grid' && commandFor(event.nativeEvent) === 'preview';
    const action = peek ? () => openPreview(id) : keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }
  // Commands act on the row the keyboard is on while focus is in the tree.
  const commands = useCommands({
    // Opens that row's menu below it, scrolling it into view first, since the tree can be
    // scrolled away from it.
    contextMenu() {
      const row = rows[active];
      if (row) {
        virtualizer.scrollToIndex(active, { align: 'auto' });
        showEntryMenuBelow(row.entry, () => container.current?.querySelector('[data-active]'));
      }
    },
    rename() {
      const row = rows[active];
      if (row) {
        rename(row.entry);
      }
    },
  });
  const ref = useMemo(() => mergeRefs(container, commands), [commands]);
  function toggle(id: string) {
    const open = !expanded(id);
    if (open) {
      motion.reveal([id]);
    } else {
      motion.conceal((folder) => folder === id);
    }
    tree.setExpanded(id, open);
  }
  function collapseAll() {
    motion.conceal((folder) => folder !== root.id);
    tree.collapseAll();
  }

  // Rows a closed folder hid have no index, and slide away from where they were.
  function renderRow(row: TreeRow, top: number, index?: number, slide?: Slide) {
    // Clicks move the keyboard position too, and keep focus on the tree.
    const choose = () => {
      select(row.entry.id);
      container.current?.focus();
    };
    return (
      <FolderRow
        key={row.entry.id}
        id={index === undefined ? undefined : `${treeId}-${index}`}
        row={row}
        active={index === active}
        selected={row.entry.id === current}
        expanded={expanded(row.entry.id)}
        expandable={expandable(row.entry.id)}
        onToggle={() => {
          choose();
          toggle(row.entry.id);
        }}
        onNavigate={() => {
          choose();
          onNavigate(trailOf(row));
        }}
        top={top}
        slide={slide}
        leaving={index === undefined}
      />
    );
  }

  return (
    <Sidebar label="Library">
      <SidebarTitleBar>
        <IconButton
          label={tree.anyExpanded ? 'Collapse all folders' : 'Expand all folders'}
          onClick={tree.anyExpanded ? collapseAll : () => tree.expandAll(motion.reveal)}
        >
          {tree.anyExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
        </IconButton>
        <OpenFolderButton />
      </SidebarTitleBar>
      <SidebarHeading
        accessory={
          <Badge>{mode === 'filmstrip' ? 'All photos' : LOCATION_LABELS[root.location]}</Badge>
        }
      >
        Folders
      </SidebarHeading>
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-auto focus-visible:outline-none"
        role="tree"
        data-keys="treeFocus"
        aria-label="Folders"
        tabIndex={0}
        aria-activedescendant={rows[active] ? `${treeId}-${active}` : undefined}
        onKeyDown={handleKey}
      >
        <div
          className="group/tree relative w-full"
          data-moving={motion.moving || undefined}
          style={
            {
              '--folder-cover': `${coverSize}px`,
              height: virtualizer.getTotalSize(),
            } as CSSProperties
          }
          onTransitionEnd={(event) => motion.settle(event)}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return row && renderRow(row, item.start, item.index, motion.entering.get(item.index));
          })}
          <div inert aria-hidden className="contents">
            {motion.leaving.map(({ row, top, slide }) => renderRow(row, top, undefined, slide))}
          </div>
        </div>
      </div>
      <FolderTreeFooter
        name={root.name}
        coverSize={coverSize}
        onCoverSize={(size) => {
          setCoverSize(size);
          // Rows already laid out keep their old height until the virtualizer forgets it.
          virtualizer.measure();
        }}
      />
    </Sidebar>
  );
}
