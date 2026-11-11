import { Unavailable } from '#components/viewer/unavailable';
import { seekBy, togglePlayback, VideoControls } from '#components/viewer/video-controls';
import { setViewerPreferences, useViewerPreferences } from '#data/viewer-preferences';
import { useCachedThumbnail, useLibrary } from '#hooks/use-library';
import { runCommand, useCommands } from '#keyboard/commands';
import { cn, FloatingControls, LoadingState } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { type CSSProperties, useEffect, useEffectEvent, useState } from 'react';

/** How far Shift-Left or Shift-Right skips. */
const SEEK_SECONDS = 5;
/**
 * A video filling the viewer, with its own controls and keys. Its thumbnail stands in until
 * the first frame arrives. `url` is `undefined` while it resolves and `null` if the original
 * is unavailable. While `active`, nothing covers it, so it plays and hears its keys. With
 * `onFinished`, as in a slideshow, it plays once and then calls it. `onShown` is called once
 * it has a frame to show, or has failed.
 */
export function OriginalVideo({
  entry,
  url,
  active,
  onFinished,
  onShown,
}: {
  entry: PhotoEntry;
  url: string | null | undefined;
  active: boolean;
  onFinished?: () => void;
  onShown?: () => void;
}) {
  const library = useLibrary();
  const { muted } = useViewerPreferences();
  const thumbnail = library.peekThumbnail(entry.id);
  const cached = useCachedThumbnail(entry);
  // The frame it starts on, so nothing jumps as it plays; the thumbnail, from further in, only
  // when that could not be read: one made this session, or else the cached one, if any.
  const poster =
    library.peekOpeningFrame(entry.id) ?? (thumbnail?.status === 'ready' ? thumbnail.url : cached);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // The video's width over its height, once its metadata has loaded.
  const [ratio, setRatio] = useState<number>();
  // State rather than a ref, so the controls render once the element exists.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Watched: paused, played or seeked since it came up. Until then the controls keep the keys
  // that seek and move on out of the way, so a slideshow or a quick browse stays uncluttered.
  // Each video mounts afresh as it comes up, so this starts over every visit. It
  // is set from the video's own pause and seek events, so the controls change once the press
  // that paused it is over, never under the pointer mid-click.
  const [watching, setWatching] = useState(false);
  const watch = () => {
    if (active) {
      setWatching(true);
    }
  };
  /** Plays, pauses or seeks, which shows the video is being watched. */
  function control(action: (element: HTMLVideoElement) => void) {
    if (video) {
      watch();
      action(video);
    }
  }
  // Starts playing once it is in the document, not as `autoPlay` would: a deferred switch
  // can create the element and then discard it, unmounted, where it would play on unseen,
  // and heard, with nothing left to pause it.
  const start = useEffectEvent((element: HTMLVideoElement) => {
    if (active) {
      // Rejects when a pause or source change interrupts it, which needs no handling.
      element.play().catch(() => null);
    }
  });
  useEffect(() => {
    if (video) {
      start(video);
    }
  }, [video]);
  // A covered video must not keep playing under whatever covers it.
  useEffect(() => {
    if (!active) {
      video?.pause();
    }
  }, [active, video]);
  const commands = useCommands(
    {
      mute: () => setViewerPreferences({ muted: !muted }),
      playPause: () => control(togglePlayback),
      seekBackward: () => control((element) => seekBy(element, -SEEK_SECONDS)),
      seekForward: () => control((element) => seekBy(element, SEEK_SECONDS)),
    },
    { fallback: true },
  );
  if (status === 'error' || url === null) {
    return (
      <Unavailable
        title="Unable to play this video"
        description="The original may be missing or use a format that cannot be played."
        onShown={onShown}
      />
    );
  }
  return (
    // The keymap's `videoShown` and `watching` hold wherever focus is in this video's layer.
    <div
      ref={commands}
      className="contents"
      data-layer-keys={video ? cn('videoShown', watching && 'watching') : undefined}
    >
      {status === 'loading' && !poster && (
        <LoadingState label="Loading video…" className="absolute inset-0" />
      )}
      {url && (
        <span className="@container-size absolute inset-0 flex items-center justify-center p-5">
          {/* The user's own videos come without caption files to show. */}
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={(node: HTMLVideoElement) => {
              // A deferred switch creates the element before it mounts, so it can have loaded,
              // or failed, before its events had a component to update.
              if (node.error) {
                setStatus('error');
              } else if (node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                setStatus('ready');
              }
              if (node.readyState >= HTMLMediaElement.HAVE_METADATA) {
                setRatio(node.videoWidth / node.videoHeight);
              }
              setVideo(node);
              // Fires once a frame of the video itself is ready to be drawn, unlike `loadeddata`,
              // which can come while only the poster is on screen.
              const frame = node.requestVideoFrameCallback(() => onShown?.());
              return () => {
                node.cancelVideoFrameCallback(frame);
                setVideo(null);
              };
            }}
            // Sized to the picture once its shape is known, so it casts a photo's shadow; until
            // then the poster is letterboxed in the whole space.
            style={{ '--ratio': ratio } as CSSProperties}
            className={ratio ? 'contain-media shadow-photo' : 'size-full object-contain'}
            aria-label={entry.name}
            src={url}
            poster={poster}
            loop={!onFinished}
            muted={muted}
            playsInline
            onLoadedMetadata={(event) =>
              setRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)
            }
            onLoadedData={() => setStatus('ready')}
            onError={() => {
              setStatus('error');
              onShown?.();
            }}
            onEnded={onFinished}
            onPause={watch}
            onSeeking={watch}
            onClick={(event) => {
              // The second click of a double-click leaves playback to the double-click.
              if (event.detail <= 1) {
                togglePlayback(event.currentTarget);
              }
            }}
            onDoubleClick={(event) => {
              // Goes full screen, and undoes what its first click did to playback, as a video
              // player does.
              togglePlayback(event.currentTarget);
              runCommand('fullScreen');
            }}
          />
        </span>
      )}
      {video && (
        <FloatingControls position="bottom">
          <VideoControls video={video} watching={watching} />
        </FloatingControls>
      )}
    </div>
  );
}
