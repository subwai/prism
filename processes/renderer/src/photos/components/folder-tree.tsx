import { useEntryMenuBelow, useRenameEntry } from '#photos/components/entry-menu';
import { FolderPeek } from '#photos/components/folder-peek';
import { FolderRow, type TreeRow } from '#photos/components/folder-row';
import { OpenFolderButton } from '#photos/components/open-folder-button';
import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries, type ViewMode } from '#photos/data/entries';
import { commandFor } from '#photos/data/keymap';
import { useCommand } from '#photos/hooks/use-command';
import { useLibrary } from '#photos/hooks/use-library';
import {
  Badge,
  IconButton,
  Sidebar,
  SidebarFooter,
  SidebarHeading,
  SidebarTitleBar
} from '@app/design-system';
import type { PhotoEntry, PhotoFolder } from '@app/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronsDownUp, ChevronsUpDown, FolderOpen } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';

const ROW_HEIGHT = 34;

export type FolderTrail = PhotoFolder[];

const folderLists = new WeakMap<ScanState, PhotoEntry[]>();
function folders(state: ScanState | undefined) {
  if (!state) {
    return [];
  }
  let list = folderLists.get(state);
  if (!list) {
    const directories = state.entries.filter((entry) => entry.kind === 'directory');
    list = arrangeEntries(directories, '', 'name', false);
    folderLists.set(state, list);
  }
  return list;
}

export function FolderTree({
  root,
  trail,
  onNavigate,
  mode
}: {
  root: PhotoFolder;
  trail: FolderTrail;
  onNavigate: (trail: FolderTrail) => void;
  mode: ViewMode;
}) {
  const library = useLibrary();
  // Re-render as folder reads settle; after a refresh, old children show until re-read.
  useSyncExternalStore(library.subscribe, library.getVersion);
  const [opened, setOpened] = useState(() => new Map([[root.id, true]]));
  const container = useRef<HTMLDivElement>(null);
  const treeId = useId();
  const current = trail.at(-1)?.id;
  // The keyboard position starts at, and follows navigation to, the current folder.
  const [cursor, setCursor] = useState({ at: current, id: current });
  const [peek, setPeek] = useState<FolderTrail | null>(null);
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  // The key that opened a peek closes it, from anywhere in the sheet.
  useCommand('preview', () => peek && setPeek(null));
  // Bumped by collapsing, so an expansion still reading folders stops opening them.
  const expansion = useRef(0);
  const ancestors = useMemo(() => new Set(trail.slice(0, -1).map((folder) => folder.id)), [trail]);
  const expanded = useCallback(
    (id: string) => opened.get(id) ?? ancestors.has(id),
    [opened, ancestors]
  );
  const rows: TreeRow[] = [];
  function append(entry: PhotoEntry, path: FolderTrail, position: number, siblings: number) {
    rows.push({ entry, position, siblings, trail: path });
    if (expanded(entry.id)) {
      const children = folders(library.peekDirectory(entry.id)?.value);
      for (const [index, child] of children.entries()) {
        append(child, [...path, child], index + 1, children.length);
      }
    }
  }
  append({ ...root, kind: 'directory', parentId: root.id }, [root], 1, 1);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => container.current,
    overscan: 4
  });
  const cursorId = cursor.at === current ? cursor.id : current;
  const visible = (id: string | undefined) => rows.findIndex((row) => row.entry.id === id);
  // A current folder hidden inside a collapsed one starts from its nearest visible ancestor.
  const fallback = trail.findLast((folder) => visible(folder.id) !== -1);
  const active = Math.max(0, visible(cursorId) === -1 ? visible(fallback?.id) : visible(cursorId));
  function expandable(id: string) {
    const state = library.peekDirectory(id)?.value;
    return !state || state.error !== null || folders(state).length > 0;
  }
  function moveTo(index: number) {
    const row = rows[index];
    if (row) {
      setCursor({ at: current, id: row.entry.id });
      virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  }
  // The WAI-ARIA tree pattern, plus Shift-Space to peek and Enter to open, as in the gallery.
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const row = rows[active];
    if (!row || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const { id } = row.entry;
    const open = expanded(id);
    const canExpand = library.peekSummary(id)?.value?.hasSubfolders ?? expandable(id);
    const parent = visible(row.trail.at(-2)?.id);
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
      Enter: () => onNavigate(row.trail),
      Home: () => moveTo(0)
    };
    const action =
      commandFor(event.nativeEvent) === 'preview' ? () => setPeek(row.trail) : keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }
  // Keyboard commands act on the row the keyboard is on while focus is in the tree.
  const focused = () => container.current?.contains(document.activeElement) ?? false;
  useCommand('rename', () => {
    const row = rows[active];
    if (row && focused()) {
      rename(row.entry);
    }
  });
  // Opens that row's menu below it, scrolling it into view first, since the tree can be
  // scrolled away from it.
  useCommand('contextMenu', () => {
    const row = rows[active];
    if (row && focused()) {
      virtualizer.scrollToIndex(active, { align: 'auto' });
      showEntryMenuBelow(row.entry, () => container.current?.querySelector('[data-active]'));
    }
  });
  function toggle(id: string) {
    if (!expanded(id)) {
      library.directory(id).catch(() => null);
    }
    setOpened((previous) => new Map(previous).set(id, !expanded(id)));
  }
  const anyExpanded = rows.some((row) => row.trail.length > 1 && expanded(row.entry.id));
  // Back to the initial tree: only the root open, including the current folder's ancestors.
  function collapseAll() {
    expansion.current += 1;
    const closed = [...opened.keys(), ...ancestors].map((id): [string, boolean] => [id, false]);
    setOpened(new Map([...closed, [root.id, true]]));
  }
  // Opens the whole tree level by level, as each level's folders are read.
  async function expandAll() {
    expansion.current += 1;
    const run = expansion.current;
    let level = [root.id];
    while (level.length > 0) {
      const states = await Promise.all(level.map((id) => library.directory(id)));
      if (run !== expansion.current) {
        return;
      }
      level = states.flatMap((state) => folders(state).map((folder) => folder.id));
      const next = level;
      setOpened(
        (previous) => new Map([...previous, ...next.map((id): [string, boolean] => [id, true])])
      );
    }
  }

  return (
    <Sidebar label="Library">
      <SidebarTitleBar>
        <IconButton
          label={anyExpanded ? 'Collapse all folders' : 'Expand all folders'}
          onClick={anyExpanded ? collapseAll : expandAll}
        >
          {anyExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
        </IconButton>
        <OpenFolderButton />
      </SidebarTitleBar>
      <SidebarHeading accessory={<Badge>{mode === 'filmstrip' ? 'All photos' : 'Local'}</Badge>}>
        Folders
      </SidebarHeading>
      <div
        ref={container}
        className="min-h-0 flex-1 overflow-auto focus-visible:outline-none"
        role="tree"
        data-keys="treeFocus"
        aria-label="Folders"
        tabIndex={0}
        aria-activedescendant={rows[active] ? `${treeId}-${active}` : undefined}
        onKeyDown={handleKey}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) {
              return null;
            }
            // Clicks move the keyboard position too, and keep focus on the tree.
            const select = () => {
              setCursor({ at: current, id: row.entry.id });
              container.current?.focus();
            };
            return (
              <FolderRow
                key={row.entry.id}
                id={`${treeId}-${item.index}`}
                row={row}
                active={item.index === active}
                selected={row.entry.id === current}
                expanded={expanded(row.entry.id)}
                expandable={expandable(row.entry.id)}
                onToggle={() => {
                  select();
                  toggle(row.entry.id);
                }}
                onNavigate={(next) => {
                  select();
                  onNavigate(next);
                }}
                top={item.start}
              />
            );
          })}
        </div>
      </div>
      {peek && (
        <FolderPeek initialTrail={peek} onClose={() => setPeek(null)} onNavigate={onNavigate} />
      )}
      <SidebarFooter>
        <FolderOpen size={14} />
        <span className="truncate">{root.name}</span>
        <Badge className="ml-auto">Local</Badge>
      </SidebarFooter>
    </Sidebar>
  );
}
