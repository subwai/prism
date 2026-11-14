import { useVisible } from '#components/use-visible';
import { unsettled } from '#data/folder-tiles';
import { useCachedThumbnail, useLibrary } from '#hooks/use-library';
import { useRating } from '#hooks/use-rating';
import { cn, MediaCaption, RatingBadge } from '@prism/design-system';
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
 * An image that shows once it has loaded, and `placeholder` until then. A cached thumbnail is
 * found through the folder's worker, which on a network share can take a while, so the tile
 * keeps its icon meanwhile rather than standing empty, and an image that fails never shows as
 * broken before the tile turns to something else. One the browser decoded already shows on its
 * first frame, and a new `src` keeps the last image up until it loads, as the browser does.
 */
function LoadedImage({
  src,
  placeholder = null,
  onError,
}: {
  src: string;
  placeholder?: ReactNode;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <img
        ref={(node) => {
          if (node?.complete && node.naturalWidth > 0) {
            setLoaded(true);
          }
        }}
        src={src}
        alt=""
        draggable={false}
        className={cn('block size-full object-cover', !loaded && 'hidden')}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          onError?.();
        }}
      />
      {!loaded && placeholder}
    </>
  );
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
  return <LoadedImage src={cached} placeholder={placeholder} onError={() => setMissing(cached)} />;
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
    shown = <LoadedImage src={result.url} placeholder={placeholder} />;
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
  /** `undefined` until the catalog has worked out the folder's tile. */
  summary: FolderSummary | undefined;
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

/**
 * A folder's cover, from its row, which the catalog keeps. While it is on show and its row may
 * not say all of it, as for a folder not read or with no photos of its own, the worker reads the
 * folder in the background, and the row shows what it found once read again.
 */
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
  const read = visible && unsettled(entry.summary) ? () => library.readTile(entry.id) : undefined;
  return (
    <span ref={read} className="contents">
      <FolderCoverContents summary={entry.summary} compact={compact} visible={visible} />
    </span>
  );
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
  const compact = size === 'icon';
  // Cached thumbnails paint on the first frame, as do folders' covers, which their rows hold;
  // thumbnails not cached wait to scroll into view to be made.
  const folder = entry.kind === 'directory';
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
      {folder && <FolderCover key={entry.id} entry={entry} compact={compact} visible={visible} />}
      {!folder && (
        <ThumbnailImage
          key={entry.id}
          entry={entry}
          iconSize={compact ? 10 : 24}
          visible={visible}
        />
      )}
      {!compact && <Caption entry={entry} named={named} />}
      {!compact && <Stars entry={entry} />}
    </div>
  );
}

/** The stars a card's entry is rated, as soon as they are chosen. */
function Stars({ entry }: { entry: PhotoEntry }) {
  const { rating } = useRating(entry);
  return rating === undefined ? null : <RatingBadge stars={rating} />;
}

function Caption({ entry, named }: { entry: PhotoEntry; named: boolean }) {
  if (!named && entry.kind !== 'video' && entry.kind !== 'directory') {
    return null;
  }
  const Icon = KIND_ICONS[entry.kind];
  return <MediaCaption icon={<Icon />}>{named && entry.name}</MediaCaption>;
}
