import { useVisible } from '#components/use-visible';
import { useCachedThumbnail, useLibrary } from '#hooks/use-library';
import { cn, MediaCaption } from '@prism/design-system';
import type { FolderSummary, PhotoEntry } from '@prism/shared';
import { useQuery } from '@tanstack/react-query';
import { File, Film, Folder, Image, ImageOff, Video } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface ThumbnailImageProps {
  entry: PhotoEntry;
  iconSize: number;
  /** Whether the tile is on screen, which a thumbnail not cached yet waits for to be made. */
  visible: boolean;
  /** Shown in turn instead, while this one has no thumbnail, as a folder's other covers. */
  fallbacks?: PhotoEntry[];
  placeholder?: ReactNode;
}

/**
 * The cached thumbnail, which shows on the first frame it can, with no call to make it first.
 * One that is not cached fails to load, and is made instead.
 */
function ThumbnailImage({ entry, iconSize, visible, fallbacks, placeholder }: ThumbnailImageProps) {
  const cached = useCachedThumbnail(entry);
  // The URL that failed, so a new one, as the file changes or a refresh reads it again, is tried.
  const [missing, setMissing] = useState<string | null>(null);
  if (missing === cached) {
    return (
      <MadeThumbnail
        entry={entry}
        iconSize={iconSize}
        visible={visible}
        fallbacks={fallbacks}
        placeholder={placeholder}
      />
    );
  }
  return (
    <img
      src={cached}
      alt=""
      draggable={false}
      className="block size-full object-cover"
      onError={() => setMissing(cached)}
    />
  );
}

/**
 * A thumbnail that was not cached, made once the tile is on screen. While it is, the tile shows
 * the placeholder, if any; icons explain a missing picture. It is wanted while it shows, even as
 * one of a folder's covers. It reads its query without suspending: React holds back a Suspense
 * boundary's content for up to 300 ms after its fallback shows, which would keep a thumbnail made
 * in a few milliseconds off screen that long.
 */
function MadeThumbnail({
  entry,
  iconSize,
  visible,
  fallbacks,
  placeholder = null,
}: ThumbnailImageProps) {
  const library = useLibrary();
  const want = visible ? () => library.want(entry.id) : undefined;
  const { data: result } = useQuery({ ...library.thumbnailQuery(entry.id), enabled: visible });
  let shown: ReactNode = placeholder;
  const [next, ...rest] = fallbacks ?? [];
  if (result?.status === 'ready') {
    shown = (
      <img src={result.url} alt="" draggable={false} className="block size-full object-cover" />
    );
  } else if (result && next) {
    shown = (
      <ThumbnailImage
        key={next.id}
        entry={next}
        iconSize={iconSize}
        visible={visible}
        fallbacks={rest}
        placeholder={placeholder}
      />
    );
  } else if (result) {
    // A video that will not decode has no still.
    const Icon = entry.kind === 'video' ? Film : ImageOff;
    shown = <Icon size={iconSize} strokeWidth={1.25} />;
  }
  return (
    <span ref={want} className="contents">
      {shown}
    </span>
  );
}

function FolderIcon({ compact }: { compact: boolean }) {
  return <Folder size={compact ? 14 : 34} strokeWidth={1.25} />;
}

/** What kind of entry a card is, beside its name in the caption. */
const KIND_ICONS = { directory: Folder, file: File, image: Image, video: Video };

function FolderCoverContents({
  summary,
  compact,
  visible,
}: {
  /** `undefined` while the folder is being inspected. */
  summary: FolderSummary | null | undefined;
  compact: boolean;
  visible: boolean;
}) {
  const iconSize = compact ? 10 : 24;
  // Gallery tiles mark the folder in their caption; sidebar icons have none, so they show a
  // folder until the cover arrives.
  const placeholder = compact ? <FolderIcon compact /> : null;
  let cover = placeholder;
  const [first, ...fallbacks] = summary?.covers ?? [];
  if (first) {
    cover = (
      <ThumbnailImage
        key={first.id}
        entry={first}
        iconSize={iconSize}
        visible={visible}
        fallbacks={fallbacks}
        placeholder={placeholder}
      />
    );
  } else if (summary && !summary.hasEntries && !compact) {
    // The caption names the folder, so the tile itself says there is nothing in it.
    cover = (
      <span className="flex flex-col items-center gap-1 text-xs">
        <FolderIcon compact={false} />
        Empty
      </span>
    );
  } else if (summary !== undefined) {
    cover = <FolderIcon compact={compact} />;
  }
  return cover;
}

function FolderCover({
  entry,
  compact,
  visible,
}: {
  entry: PhotoEntry;
  compact: boolean;
  visible: boolean;
}) {
  const library = useLibrary();
  // Without suspending, as a thumbnail being made is read, so the cover shows once it is known.
  const { data: summary } = useQuery(library.summaryQuery(entry.id));
  return <FolderCoverContents summary={summary} compact={compact} visible={visible} />;
}

/**
 * `card` fills a square grid cell; `icon` is the cover beside sidebar rows, as large as the
 * tree's `--folder-cover`. A `named` card captions its name beside an icon for its kind; the
 * filmstrip's are too small for names, so only its videos and folders are marked.
 */
export function Thumbnail({
  entry,
  size = 'card',
  named = false,
}: {
  entry: PhotoEntry;
  size?: 'card' | 'icon';
  named?: boolean;
}) {
  const { ref, visible } = useVisible(entry.id);
  const library = useLibrary();
  const compact = size === 'icon';
  // Cached thumbnails paint on the first frame, and covers read already; folders wait to
  // scroll into view to be read, and thumbnails not cached to be made.
  const folder = entry.kind === 'directory';
  const read = folder && library.peekSummary(entry.id) !== undefined;
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-inner bg-fill text-label-quaternary',
        compact
          ? 'size-(--folder-cover) shrink-0 inset-ring inset-ring-separator'
          : 'aspect-square',
      )}
    >
      {folder && (visible || read) && (
        <FolderCover key={entry.id} entry={entry} compact={compact} visible={visible} />
      )}
      {folder && !(visible || read) && compact && <FolderIcon compact />}
      {!folder && (
        <ThumbnailImage
          key={entry.id}
          entry={entry}
          iconSize={compact ? 10 : 24}
          visible={visible}
        />
      )}
      {!compact && <Caption entry={entry} named={named} />}
    </div>
  );
}

function Caption({ entry, named }: { entry: PhotoEntry; named: boolean }) {
  if (!named && entry.kind !== 'video' && entry.kind !== 'directory') {
    return null;
  }
  const Icon = KIND_ICONS[entry.kind];
  return <MediaCaption icon={<Icon />}>{named && entry.name}</MediaCaption>;
}
