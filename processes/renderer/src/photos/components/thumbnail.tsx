import { CachedValue } from '#photos/components/cached-value';
import { useLibrary } from '#photos/hooks/use-library';
import { useVisible } from '#photos/hooks/use-visible';
import { cn } from '@app/design-system';
import type { FolderSummary, PhotoEntry } from '@app/shared';
import { Folder, ImageOff } from 'lucide-react';

/** While loading, the tile stays a plain fill; icons only explain a missing picture. */
function ThumbnailImage({ id, owner, iconSize }: { id: string; owner: string; iconSize: number }) {
  const library = useLibrary();
  return (
    <CachedValue
      cached={library.peekThumbnail(id)}
      read={() => library.thumbnail(id, owner)}
      generation={library.generation}
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
        return <ImageOff size={iconSize} strokeWidth={1.25} />;
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
  if (summary?.cover) {
    cover = (
      <ThumbnailImage
        key={summary.cover.id}
        id={summary.cover.id}
        owner={entry.id}
        iconSize={iconSize}
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
      <span className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent from-55% to-black/60" />
      <span className="absolute bottom-1.75 left-1.75 z-1 flex items-center gap-1.25 text-caption text-white/95 text-shadow-overlay">
        <Folder size={12} />
        {summary && !summary.hasEntries ? 'Empty' : 'Folder'}
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
          />
        ))}
    </div>
  );
}
