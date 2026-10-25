import { useCommands } from '#keyboard/commands';
import { PhotoZoom, ZoomedPhoto, zoomToFit } from '#photos/components/photo-zoom';
import { QueryValue } from '#photos/components/query-value';
import { OriginalVideo } from '#photos/components/video-player';
import { setViewerPreferences, useViewerPreferences } from '#photos/data/viewer-preferences';
import { useLibrary } from '#photos/hooks/use-library';
import { cn, EmptyState, LoadingState } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useRef, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

/**
 * The photo, zoomable, which switches between fitting the window and actual size. `url` is
 * `undefined` while it resolves and `null` if the original is unavailable.
 */
function OriginalPhoto({ entry, url }: { entry: PhotoEntry; url: string | null | undefined }) {
  const library = useLibrary();
  const { fit } = useViewerPreferences();
  const zoom = useRef<ReactZoomPanPinchContentRef>(null);
  const thumbnail = library.peekThumbnail(entry.id);
  const placeholder = thumbnail?.status === 'ready' ? thumbnail.url : null;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const failed = status === 'error' || url === null;
  /** Between fit and actual size, zooming in around `point` when there is one. */
  function toggleFit(point?: { clientX: number; clientY: number }) {
    setViewerPreferences({ fit: !fit });
    if (zoom.current) {
      zoomToFit(zoom.current, !fit, point);
    }
  }
  const commands = useCommands({ actualSize: () => toggleFit() }, { fallback: true });
  return (
    // Double-clicking to zoom is a pointer shortcut; the keymap and the controls do the same
    // from the keyboard.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={commands}
      className={cn('absolute inset-0', !fit && 'cursor-grab active:cursor-grabbing')}
      onDoubleClick={(event) => toggleFit(event)}
    >
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
          <PhotoZoom ref={zoom} onFitChange={(fitted) => setViewerPreferences({ fit: fitted })}>
            <ZoomedPhoto
              fit={fit}
              className={status === 'ready' ? '' : 'invisible'}
              src={url}
              alt={entry.name}
              onReady={() => setStatus('ready')}
              onError={() => setStatus('error')}
            />
          </PhotoZoom>
        )
      )}
    </div>
  );
}

/**
 * The selected photo or video. Its boundary outlives the entry, so a deferred switch keeps
 * showing the last one. `active` is false while something covers it; `onFinished`, during a
 * slideshow, moves on once a video has played through.
 */
export function Original({
  entry,
  active,
  onFinished
}: {
  entry: PhotoEntry;
  active: boolean;
  onFinished?: () => void;
}) {
  const library = useLibrary();
  return (
    <QueryValue query={library.originalQuery(entry)}>
      {(url) =>
        entry.kind === 'video' ? (
          <OriginalVideo
            key={entry.id}
            entry={entry}
            url={url}
            active={active}
            onFinished={onFinished}
          />
        ) : (
          <OriginalPhoto key={entry.id} entry={entry} url={url} />
        )
      }
    </QueryValue>
  );
}
