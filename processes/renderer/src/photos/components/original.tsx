import { CachedValue } from '#photos/components/cached-value';
import { PhotoZoom, ZoomedPhoto } from '#photos/components/photo-zoom';
import { OriginalVideo } from '#photos/components/video-player';
import { useLibrary } from '#photos/hooks/use-library';
import { EmptyState, LoadingState } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { type Ref, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

/**
 * The selected photo, zoomable, or video. Its boundary outlives the entry, so a deferred
 * switch keeps showing the last one.
 */
export function Original({
  entry,
  fit,
  zoom,
  onFitChange,
  video,
  autoPlay,
  loop,
  muted,
  onEnded,
  onWatch
}: {
  entry: PhotoEntry;
  fit: boolean;
  zoom: Ref<ReactZoomPanPinchContentRef>;
  onFitChange: (fit: boolean) => void;
  video: (element: HTMLVideoElement | null) => void;
  autoPlay: boolean;
  loop: boolean;
  muted: boolean;
  onEnded: () => void;
  /** Called when a video pauses or moves to another time; see `OriginalVideo`. */
  onWatch: () => void;
}) {
  const library = useLibrary();
  return (
    <CachedValue
      cached={library.peekOriginal(entry.id)}
      read={() => library.original(entry)}
      generation={library.generation}
    >
      {(url) =>
        entry.kind === 'video' ? (
          <OriginalVideo
            key={entry.id}
            onElement={video}
            entry={entry}
            url={url}
            autoPlay={autoPlay}
            loop={loop}
            muted={muted}
            onEnded={onEnded}
            onWatch={onWatch}
          />
        ) : (
          <PhotoZoom key={entry.id} ref={zoom} onFitChange={onFitChange}>
            <OriginalPhoto entry={entry} url={url} fit={fit} />
          </PhotoZoom>
        )
      }
    </CachedValue>
  );
}

/** `url` is `undefined` while it resolves and `null` if the original is unavailable. */
function OriginalPhoto({
  entry,
  url,
  fit
}: {
  entry: PhotoEntry;
  url: string | null | undefined;
  fit: boolean;
}) {
  const library = useLibrary();
  const thumbnail = library.peekThumbnail(entry.id)?.value;
  const placeholder = thumbnail?.status === 'ready' ? thumbnail.url : null;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const failed = status === 'error' || url === null;
  return (
    <>
      {/* When the viewer opens, the grid thumbnail stands in, scaled up, until the original has decoded. */}
      {status === 'loading' &&
        !failed &&
        (placeholder ? (
          <span className="absolute inset-0 p-5">
            <img src={placeholder} alt="" className="size-full object-contain" draggable={false} />
          </span>
        ) : (
          <LoadingState label="Loading photo…" className="absolute inset-0" />
        ))}
      {failed ? (
        <EmptyState
          className="absolute inset-0"
          title="Unable to display this photo"
          description="The original may be missing or use an unsupported format."
        />
      ) : (
        url && (
          <ZoomedPhoto
            fit={fit}
            className={status === 'ready' ? '' : 'invisible'}
            src={url}
            alt={entry.name}
            onReady={() => setStatus('ready')}
            onError={() => setStatus('error')}
          />
        )
      )}
    </>
  );
}
