import { CachedValue } from '#photos/components/cached-value';
import { useLibrary } from '#photos/hooks/use-library';
import { useVisible } from '#photos/hooks/use-visible';
import { cn } from '@app/design-system';
import type { FolderSummary, PhotoEntry } from '@app/shared';
import { Film, Folder, ImageOff, Video } from 'lucide-react';
import { type ReactNode, useSyncExternalStore } from 'react';

/** While loading, the tile stays a plain fill; icons only explain a missing picture. */
function ThumbnailImage({
  id,
  owner,
  iconSize,
  video = false,
  fallbacks
}: {
  id: string;
  owner: string;
  iconSize: number;
  /** Shows a film icon if it has no still, such as a video that will not decode. */
  video?: boolean;
  /** Shown in turn instead, while this one has no thumbnail, as a folder's other covers. */
  fallbacks?: PhotoEntry[];
}) {
  const library = useLibrary();
  // Read again when the file changes on disk; other changes leave this thumbnail alone.
  const revision = useSyncExternalStore(library.subscribe, () => library.revision(id));
  return (
    <CachedValue
      cached={library.peekThumbnail(id)}
      read={() => library.thumbnail(id, owner)}
      generation={`${library.generation}:${revision}`}
    >
      {(result) => {
        if (!result) {
          return null;
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
              owner={owner}
              iconSize={iconSize}
              video={next.kind === 'video'}
              fallbacks={rest}
            />
          );
        }
        const Icon = video ? Film : ImageOff;
        return <Icon size={iconSize} strokeWidth={1.25} />;
      }}
    </CachedValue>
  );
}

function FolderCoverContents({
  entry,
  summary,
  compact
}: {
  entry: PhotoEntry;
  /** `undefined` while the folder is being inspected. */
  summary: FolderSummary | null | undefined;
  compact: boolean;
}) {
  const iconSize = compact ? 10 : 24;
  let cover = null;
  const [first, ...fallbacks] = summary?.covers ?? [];
  if (first) {
    cover = (
      <ThumbnailImage
        key={first.id}
        id={first.id}
        owner={entry.id}
        iconSize={iconSize}
        video={first.kind === 'video'}
        fallbacks={fallbacks}
      />
    );
  } else if (summary !== undefined) {
    cover = <Folder size={iconSize * 1.4} strokeWidth={1.25} />;
  }
  if (compact) {
    return cover;
  }
  return (
    <>
      {cover}
      <Caption icon={<Folder size={12} />}>
        {summary && !summary.hasEntries ? 'Empty' : 'Folder'}
      </Caption>
    </>
  );
}

/** A label over the bottom of a card's picture, saying what kind of entry it is. */
function Caption({ icon, children }: { icon: ReactNode; children?: ReactNode }) {
  return (
    <>
      <span className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent from-55% to-black/60" />
      <span className="text-caption text-shadow-overlay absolute bottom-1.75 left-1.75 z-1 flex items-center gap-1.25 text-white/95">
        {icon}
        {children}
      </span>
    </>
  );
}

function FolderCover({ entry, compact }: { entry: PhotoEntry; compact: boolean }) {
  const library = useLibrary();
  return (
    <CachedValue
      cached={library.peekSummary(entry.id)}
      read={() => library.summary(entry.id)}
      generation={library.generation}
    >
      {(summary) => <FolderCoverContents entry={entry} summary={summary} compact={compact} />}
    </CachedValue>
  );
}

/** `card` fills a square grid cell; `icon` is the small cover beside sidebar rows. */
export function Thumbnail({ entry, size = 'card' }: { entry: PhotoEntry; size?: 'card' | 'icon' }) {
  const { ref, visible } = useVisible(entry.id);
  const library = useLibrary();
  const compact = size === 'icon';
  // Cached covers paint on the first frame; only uncached ones wait to scroll into view.
  const cached =
    entry.kind === 'directory' ? library.peekSummary(entry.id) : library.peekThumbnail(entry.id);
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-inner bg-fill text-label-quaternary',
        compact ? 'size-5.5 shrink-0 inset-ring inset-ring-separator' : 'aspect-square'
      )}
    >
      {(visible || cached) &&
        (entry.kind === 'directory' ? (
          <FolderCover key={entry.id} entry={entry} compact={compact} />
        ) : (
          <ThumbnailImage
            key={entry.id}
            id={entry.id}
            owner={entry.id}
            iconSize={compact ? 10 : 24}
            video={entry.kind === 'video'}
          />
        ))}
      {entry.kind === 'video' && !compact && <Caption icon={<Video size={12} />} />}
    </div>
  );
}
