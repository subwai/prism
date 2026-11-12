import { Thumbnail } from '#components/thumbnail';
import { FilteredValues } from '#components/trash/filtered-values';
import type { PlanState } from '#components/trash/plan-state';
import { SheetFooter } from '#components/trash/sheet-footer';
import { formatSize } from '#data/entries';
import type { GalleryView } from '#data/gallery-view';
import { photoEntryOf } from '#data/trash';
import { LoadingState } from '@prism/design-system';
import type { PhotoFilter, TrashFile, TrashFiles } from '@prism/shared';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

const ROW_HEIGHT = 44;
const HEADING_HEIGHT = 34;

/** A line of the list: a section's heading, or an entry in it. */
type FileLine = { type: 'heading'; label: string } | { type: 'file'; file: TrashFile };

function linesOf({ trashed, moved }: TrashFiles): FileLine[] {
  const section = (label: string, files: TrashFile[]): FileLine[] =>
    files.length === 0
      ? []
      : [
          { label: `${label} · ${files.length.toLocaleString()}`, type: 'heading' },
          ...files.map((file): FileLine => ({ file, type: 'file' })),
        ];
  return [...section('To the Trash', trashed), ...section('Moved out first', moved)];
}

/** What an entry is, or where it moves to, as its line says. */
function detailOf({ entry, owner, to }: TrashFile): string {
  if (to !== undefined) {
    return `Moves to ${to === '.' ? 'the top folder' : to}`;
  }
  if (owner !== undefined) {
    return `Sidecar of ${owner}`;
  }
  if (entry.kind === 'directory') {
    return 'Folder';
  }
  return entry.size === null ? '' : formatSize(entry.size);
}

function FileRow({ file, filter }: { file: TrashFile; filter: PhotoFilter }) {
  const { entry } = file;
  const folder = entry.parentId === '.' ? '' : `${entry.parentId}/`;
  return (
    <div className="border-separator flex h-full items-center gap-3 border-b px-5">
      <Thumbnail entry={photoEntryOf(entry)} size="icon" />
      <span className="min-w-0 truncate" title={entry.id}>
        <span className="text-label-secondary">{folder}</span>
        {entry.name}
      </span>
      <FilteredValues entry={entry} filter={filter} />
      <span className="flex-1" />
      <span className="text-label-secondary shrink-0 text-sm">{detailOf(file)}</span>
    </div>
  );
}

function FilesList({ files, filter }: { files: TrashFiles; filter: PhotoFilter }) {
  // TanStack Virtual's virtualizer changes in place, so React Compiler would keep showing
  // the lines it first rendered.
  'use no memo';
  const lines = linesOf(files);
  const container = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    estimateSize: (index) => (lines[index]?.type === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT),
    getScrollElement: () => container.current,
    overscan: 10,
  });
  if (lines.length === 0) {
    return (
      <p className="text-label-secondary flex-1 px-5 py-4 text-sm">
        Nothing goes to the Trash as decided.
      </p>
    );
  }
  return (
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto [--folder-cover:--spacing(8)]">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index];
          if (!line) {
            return null;
          }
          return (
            <div
              key={item.key}
              className="absolute inset-x-0 top-0"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {line.type === 'heading' ? (
                <h3 className="bg-surface border-separator flex h-full items-center border-b px-5 text-sm font-semibold">
                  {line.label}
                </h3>
              ) : (
                <FileRow file={line.file} filter={filter} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Every file and folder the plan moves, one by one at every depth, as it is decided now: what
 * goes to the Trash, folders before what they hold, then what moves out of them first.
 */
export function FilesView({
  view,
  version,
  plan,
  filter,
  folderName,
  onClose,
}: {
  view: GalleryView;
  version: number;
  plan: PlanState;
  /** The filter the plan is of, whose fields each entry shows its values of. */
  filter: PhotoFilter;
  folderName: string;
  onClose: () => void;
}) {
  const { data } = useQuery(view.trashFilesQuery(version, plan.choices));
  if (!data) {
    return <LoadingState label="Listing what goes…" />;
  }
  const { trashed, moved } = data;
  return (
    <>
      <FilesList files={data} filter={filter} />
      <SheetFooter onClose={onClose}>
        <span className="text-label-secondary text-sm">
          {trashed.length.toLocaleString()} to the Trash
          {moved.length > 0 && ` · ${moved.length.toLocaleString()} moved out`} · everything else in
          “{folderName}” stays
        </span>
      </SheetFooter>
    </>
  );
}
