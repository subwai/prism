import { QueryValue } from '#components/query-value';
import { PhotoZoom, ZoomedPhoto, zoomToFit } from '#components/viewer/photo-zoom';
import { Unavailable } from '#components/viewer/unavailable';
import { OriginalVideo } from '#components/viewer/video-player';
import { setViewerPreferences, useViewerPreferences } from '#data/viewer-preferences';
import { useLibrary } from '#hooks/use-library';
import { runCommand, useCommands } from '#keyboard/commands';
import { cn, LoadingState } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useCallback, useRef, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

/**
 * The photo, zoomable, which switches between fitting the window and actual size. `url` is
 * `undefined` while it resolves and `null` if the original is unavailable.
 */
function OriginalPhoto({
  entry,
  url,
  onShown
}: {
  entry: PhotoEntry;
  url: string | null | undefined;
  onShown?: () => void;
}) {
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
    // Double-clicking goes full screen, or with Option (Alt) zooms around the pointer: pointer
    // shortcuts for what the keymap and the controls do from the keyboard.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={commands}
      className={cn('absolute inset-0', !fit && 'cursor-grab active:cursor-grabbing')}
      onDoubleClick={(event) => (event.altKey ? toggleFit(event) : runCommand('fullScreen'))}
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
        <Unavailable
          title="Unable to display this photo"
          description="The original may be missing or use an unsupported format."
          onShown={onShown}
        />
      ) : (
        url && (
          <PhotoZoom ref={zoom} onFitChange={(fitted) => setViewerPreferences({ fit: fitted })}>
            <ZoomedPhoto
              fit={fit}
              className={status === 'ready' ? '' : 'invisible'}
              src={url}
              alt={entry.name}
              onReady={() => {
                setStatus('ready');
                onShown?.();
              }}
              onError={() => {
                setStatus('error');
                onShown?.();
              }}
            />
          </PhotoZoom>
        )
      )}
    </div>
  );
}

/**
 * The selected photo or video. `active` is false while something covers it; `onFinished`,
 * during a slideshow, moves on once a video has played through. `onShown` is called once the
 * photo has decoded or the video has a frame to show, or either has failed.
 */
export function Original({
  entry,
  active,
  onFinished,
  onShown
}: {
  entry: PhotoEntry;
  active: boolean;
  onFinished?: () => void;
  onShown?: () => void;
}) {
  const library = useLibrary();
  const want = useCallback(() => library.want(entry.id), [library, entry.id]);
  // Its original is read once it is wanted on screen, as a thumbnail is.
  return (
    <span ref={want} className="contents">
      <QueryValue query={library.originalQuery(entry)}>
        {(url) =>
          entry.kind === 'video' ? (
            <OriginalVideo
              key={entry.id}
              entry={entry}
              url={url}
              active={active}
              onFinished={onFinished}
              onShown={onShown}
            />
          ) : (
            <OriginalPhoto key={entry.id} entry={entry} url={url} onShown={onShown} />
          )
        }
      </QueryValue>
    </span>
  );
}
