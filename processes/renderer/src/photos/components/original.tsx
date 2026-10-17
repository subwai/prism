import { CachedValue } from '#photos/components/cached-value';
import { PhotoZoom, ZoomedPhoto } from '#photos/components/photo-zoom';
import { OriginalVideo } from '#photos/components/video-player';
import { useLibrary } from '#photos/hooks/use-library';
import { LoadingState } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { type Ref, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

const MESSAGE = 'absolute top-1/2 left-1/2 -translate-1/2 text-center text-label-tertiary';

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
  onEnded
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
        <div className={MESSAGE}>
          <strong className="text-headline text-label-secondary font-medium">
            Unable to display this photo
          </strong>
          <p className="mt-2 leading-relaxed">
            The original may be missing or use an unsupported format.
          </p>
        </div>
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
