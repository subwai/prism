import { QueryValue } from '#components/query-value';
import { useVisible } from '#components/use-visible';
import { useLibrary } from '#hooks/use-library';
import { cn, MediaCaption } from '@prism/design-system';
import type { FolderSummary, PhotoEntry } from '@prism/shared';
import { File, Film, Folder, Image, ImageOff, Video } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';

/**
 * While loading, the tile shows the placeholder, if any; icons explain a missing picture. The
 * thumbnail is wanted while this is on screen, even as one of a folder's covers.
 */
function ThumbnailImage({
  id,
  iconSize,
  video = false,
  fallbacks,
  placeholder = null,
}: {
  id: string;
  iconSize: number;
  /** Shows a film icon if it has no still, such as a video that will not decode. */
  video?: boolean;
  /** Shown in turn instead, while this one has no thumbnail, as a folder's other covers. */
  fallbacks?: PhotoEntry[];
  placeholder?: ReactNode;
}) {
  const library = useLibrary();
  const want = useCallback(() => library.want(id), [library, id]);
  return (
    <span ref={want} className="contents">
      <QueryValue query={library.thumbnailQuery(id)}>
        {(result) => {
          if (!result) {
            return placeholder;
          }
          if (result.status === 'ready') {
            return (
              <img
                src={result.url}
                alt=""
                draggable={false}
                className="block size-full object-cover"
              />
            );
          }
          const [next, ...rest] = fallbacks ?? [];
          if (next) {
            return (
              <ThumbnailImage
                key={next.id}
                id={next.id}
                iconSize={iconSize}
                video={next.kind === 'video'}
                fallbacks={rest}
                placeholder={placeholder}
              />
            );
          }
          const Icon = video ? Film : ImageOff;
          return <Icon size={iconSize} strokeWidth={1.25} />;
        }}
      </QueryValue>
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
}: {
  /** `undefined` while the folder is being inspected. */
  summary: FolderSummary | null | undefined;
  compact: boolean;
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
        id={first.id}
        iconSize={iconSize}
        video={first.kind === 'video'}
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

function FolderCover({ entry, compact }: { entry: PhotoEntry; compact: boolean }) {
  const library = useLibrary();
  return (
    <QueryValue query={library.summaryQuery(entry.id)}>
      {(summary) => <FolderCoverContents summary={summary} compact={compact} />}
    </QueryValue>
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
  const library = useLibrary();
  const compact = size === 'icon';
  // Cached covers paint on the first frame; only uncached ones wait to scroll into view.
  const cached =
    (entry.kind === 'directory'
      ? library.peekSummary(entry.id)
      : library.peekThumbnail(entry.id)) !== undefined;
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
      {(visible || cached) &&
        (entry.kind === 'directory' ? (
          <FolderCover key={entry.id} entry={entry} compact={compact} />
        ) : (
          <ThumbnailImage
            key={entry.id}
            id={entry.id}
            iconSize={compact ? 10 : 24}
            video={entry.kind === 'video'}
          />
        ))}
      {!(visible || cached) && compact && entry.kind === 'directory' && <FolderIcon compact />}
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
