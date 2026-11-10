import { Unavailable } from '#components/viewer/unavailable';
import { setViewerPreferences, useViewerPreferences } from '#data/viewer-preferences';
import { useCachedThumbnail, useLibrary } from '#hooks/use-library';
import { runCommand, useCommands } from '#keyboard/commands';
import { useShortcut, useShortcutLabel } from '#keyboard/shortcuts';
import {
  cn,
  FloatingControls,
  FloatingToolbar,
  FloatingToolbarDivider,
  IconButton,
  LoadingState,
  Slider,
} from '@prism/design-system';
import type { Command } from '@prism/keybindings';
import type { PhotoEntry } from '@prism/shared';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';

/** How far Shift-Left or Shift-Right skips. */
const SEEK_SECONDS = 5;

/** Plays a paused video and pauses a playing one. */
function togglePlayback(video: HTMLVideoElement) {
  if (video.paused) {
    // Rejects when a newer pause or source change interrupts it, which needs no handling.
    video.play().catch(() => null);
  } else {
    video.pause();
  }
}

/** Moves to `seconds` in, kept within the video. */
function seekTo(video: HTMLVideoElement, seconds: number) {
  if (Number.isFinite(video.duration)) {
    video.currentTime = Math.min(Math.max(seconds, 0), video.duration);
  }
}

function seekBy(video: HTMLVideoElement, seconds: number) {
  seekTo(video, video.currentTime + seconds);
}

/** `1:05`, or `1:02:05` past an hour. */
function formatTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

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
        // The user's own videos come without caption files to show.
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={(node: HTMLVideoElement) => {
            // A deferred switch creates the element before it mounts, so it can have loaded,
            // or failed, before its events had a component to update.
            if (node.error) {
              setStatus('error');
            } else if (node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              setStatus('ready');
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
          className="absolute inset-0 size-full object-contain p-5"
          aria-label={entry.name}
          src={url}
          poster={poster}
          loop={!onFinished}
          muted={muted}
          playsInline
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
      )}
      {video && (
        <FloatingControls position="bottom">
          <VideoControls video={video} watching={watching} />
        </FloatingControls>
      )}
    </div>
  );
}

/** Playback controls for `video`, which stays the source of truth for its own state. */
function VideoControls({
  video,
  watching,
}: {
  video: HTMLVideoElement;
  /** Left and Right seek rather than browse, which the controls point out. */
  watching: boolean;
}) {
  const label = useShortcutLabel();
  const shortcut = useShortcut();
  const { muted } = useViewerPreferences();
  const subscribe = (notify: () => void) => {
    const events = ['durationchange', 'pause', 'play', 'seeked', 'timeupdate'];
    for (const event of events) {
      video.addEventListener(event, notify);
    }
    return () => {
      for (const event of events) {
        video.removeEventListener(event, notify);
      }
    };
  };
  const paused = useSyncExternalStore(subscribe, () => video.paused);
  const time = useSyncExternalStore(subscribe, () => video.currentTime);
  const duration = useSyncExternalStore(subscribe, () => video.duration);
  const known = Number.isFinite(duration);
  // The keys that seek and move on, in whatever keys the keymap gives them.
  const keys = (...commands: Command[]) =>
    commands
      .map((command) => label(command))
      .filter(Boolean)
      .join(' ');
  const hint = [
    keys('seekBackward', 'seekForward') && `${keys('seekBackward', 'seekForward')} seek`,
    keys('previous', 'next') && `${keys('previous', 'next')} next`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <FloatingToolbar label="Video controls">
      <IconButton
        label={paused ? 'Play video' : 'Pause video'}
        shortcut={shortcut('playPause')}
        onClick={() => togglePlayback(video)}
      >
        {paused ? <Play /> : <Pause />}
      </IconButton>
      <span className="min-w-10 text-right tabular-nums">{formatTime(time)}</span>
      <span className="mx-2 flex">
        <Slider
          label="Playback position"
          min={0}
          max={known ? duration : 0}
          step={0.01}
          value={time}
          valueText={`${formatTime(time)} of ${formatTime(duration)}`}
          disabled={!known}
          className="w-64"
          onChange={(value) => seekTo(video, value)}
        />
      </span>
      <span className="min-w-10 tabular-nums">{formatTime(duration)}</span>
      <IconButton
        label={muted ? 'Unmute' : 'Mute'}
        shortcut={shortcut('mute')}
        onClick={() => setViewerPreferences({ muted: !muted })}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </IconButton>
      {hint && (
        // Laid out from the start, collapsed, so its arrows and ⇧, which come from a fallback
        // font, are found before it opens. It opens on a spring, stretching the toolbar out
        // past its new width before settling back. Collapsed, it is inert: out of reach of
        // screen readers, and not the toolbar's end, so the mute button rounds off the pill.
        <span
          inert={!watching}
          className={cn(
            'interpolate-size ease-jelly flex items-center overflow-hidden transition-[width,margin,opacity] duration-600 motion-reduce:transition-none',
            watching ? 'w-auto' : '-ml-0.5 w-0 opacity-0',
          )}
        >
          <FloatingToolbarDivider />
          <span className="text-label-tertiary pr-1 whitespace-nowrap">{hint}</span>
        </span>
      )}
    </FloatingToolbar>
  );
}
