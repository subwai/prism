import { Thumbnail } from '#photos/components/thumbnail';
import type { ViewMode } from '#photos/data/entries';
import { type FolderChildren, LoadFolderChildren } from '#photos/fetchers/folder-children';
import type { clientLoader as summaryLoader } from '#routes/resources+/summary';
import type { PhotoEntry, PhotoFolder } from '@app/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

export type FolderTrail = PhotoFolder[];
interface TreeRow {
  entry: PhotoEntry;
  trail: FolderTrail;
}

function FolderRow({
  row,
  selected,
  expanded,
  expandable,
  onToggle,
  onNavigate,
  top
}: {
  row: TreeRow;
  selected: boolean;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
  onNavigate: (trail: FolderTrail) => void;
  top: number;
}) {
  const summaryKey = useId();
  const summary = useFetcher<typeof summaryLoader>({ key: summaryKey });
  const canExpand = summary.data?.summary?.hasSubfolders ?? expandable;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={canExpand ? expanded : undefined}
      aria-level={row.trail.length}
      className={`folder-row ${selected ? 'selected' : ''}`}
      style={{
        paddingLeft: 8 + Math.min(row.trail.length - 1, 8) * 15,
        transform: `translateY(${top}px)`
      }}
    >
      <button
        type="button"
        className="tree-toggle"
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.entry.name}`}
        disabled={!canExpand}
        onClick={onToggle}
      >
        {canExpand && (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      <button
        type="button"
        className="folder-link"
        onClick={() => onNavigate(row.trail)}
        title={row.entry.name}
      >
        <Thumbnail entry={row.entry} summaryKey={summaryKey} />
        <span>{row.entry.name}</span>
      </button>
    </div>
  );
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
  const [directories, setDirectories] = useState(new Map<string, FolderChildren>());
  const loaded = useCallback((value: FolderChildren) => {
    setDirectories((previous) => new Map(previous).set(value.id, value));
  }, []);
  const [opened, setOpened] = useState(() => new Map([[root.id, true]]));
  const container = useRef<HTMLDivElement>(null);
  const ancestors = useMemo(() => new Set(trail.slice(0, -1).map((folder) => folder.id)), [trail]);
  const expanded = useCallback(
    (id: string) => opened.get(id) ?? ancestors.has(id),
    [opened, ancestors]
  );
  const { rows, reading } = useMemo(() => {
    const items: TreeRow[] = [];
    const branchIds: string[] = [];
    function append(entry: PhotoEntry, path: FolderTrail) {
      items.push({ entry, trail: path });
      if (!expanded(entry.id)) {
        return;
      }
      branchIds.push(entry.id);
      const children = directories.get(entry.id)?.folders ?? [];
      for (const child of children) {
        append(child, [...path, child]);
      }
    }
    append({ ...root, kind: 'directory', parentId: root.id }, [root]);
    return { reading: branchIds, rows: items };
  }, [directories, root, expanded]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 44,
    getScrollElement: () => container.current,
    overscan: 4
  });
  function toggle(id: string) {
    setOpened((previous) => new Map(previous).set(id, !expanded(id)));
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>FOLDERS</span>
        <span className="local-label">{mode === 'filmstrip' ? 'ALL PHOTOS' : 'LOCAL'}</span>
      </div>
      {reading
        .filter((id) => !directories.has(id))
        .map((id) => (
          <LoadFolderChildren key={id} id={id} onLoad={loaded} />
        ))}
      <div ref={container} className="folder-tree" role="tree" aria-label="Folders">
        <div className="virtual-content" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) {
              return null;
            }
            const state = directories.get(row.entry.id);
            const expandable = !state || state.error !== null || state.folders.length > 0;
            return (
              <FolderRow
                key={row.entry.id}
                row={row}
                selected={row.entry.id === trail.at(-1)?.id}
                expanded={expanded(row.entry.id)}
                expandable={expandable}
                onToggle={() => toggle(row.entry.id)}
                onNavigate={onNavigate}
                top={item.start}
              />
            );
          })}
        </div>
      </div>
      <div className="sidebar-footer">
        <FolderOpen size={14} />
        <span>{root.name}</span>
        <span className="local-label">LOCAL</span>
      </div>
    </aside>
  );
}
