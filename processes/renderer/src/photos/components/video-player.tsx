import { useLibrary } from '#photos/hooks/use-library';
import { shortcutLabel } from '#photos/shortcuts';
import { FloatingToolbar, IconButton, LoadingState, Slider } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';

const MESSAGE = 'absolute top-1/2 left-1/2 -translate-1/2 text-center text-label-tertiary';

/** How far Shift with Left or Right skips. */
export const SEEK_SECONDS = 5;

/** Plays a paused video and pauses a playing one. */
export function togglePlayback(video: HTMLVideoElement) {
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

export function seekBy(video: HTMLVideoElement, seconds: number) {
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
 * A video filling the viewer. Its thumbnail stands in until the first frame arrives.
 * `url` is `undefined` while it resolves and `null` if the original is unavailable.
 */
export function OriginalVideo({
  onElement,
  entry,
  url,
  autoPlay,
  loop,
  muted,
  onEnded
}: {
  /** Receives the video element while it is mounted. */
  onElement: (video: HTMLVideoElement | null) => void;
  entry: PhotoEntry;
  url: string | null | undefined;
  autoPlay: boolean;
  loop: boolean;
  muted: boolean;
  onEnded: () => void;
}) {
  const library = useLibrary();
  const thumbnail = library.peekThumbnail(entry.id)?.value;
  const poster = thumbnail?.status === 'ready' ? thumbnail.url : undefined;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  if (status === 'error' || url === null) {
    return (
      <div className={MESSAGE}>
        <strong className="text-headline text-label-secondary font-medium">
          Unable to play this video
        </strong>
        <p className="mt-2 leading-relaxed">
          The original may be missing or use a format that cannot be played.
        </p>
      </div>
    );
  }
  return (
    <>
      {status === 'loading' && !poster && (
        <LoadingState label="Loading video…" className="absolute inset-0" />
      )}
      {url && (
        <video
          ref={(node) => {
            // A deferred switch creates the element before it mounts, so it can have loaded,
            // or failed, before its events had a component to update.
            if (node?.error) {
              setStatus('error');
            } else if (node && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              setStatus('ready');
            }
            onElement(node);
            return () => onElement(null);
          }}
          className="absolute inset-0 size-full object-contain p-5"
          aria-label={entry.name}
          src={url}
          poster={poster}
          autoPlay={autoPlay}
          loop={loop}
          muted={muted}
          playsInline
          onLoadedData={() => setStatus('ready')}
          onError={() => setStatus('error')}
          onEnded={onEnded}
          onClick={(event) => togglePlayback(event.currentTarget)}
        />
      )}
    </>
  );
}

/** Playback controls for `video`, which stays the source of truth for its own state. */
export function VideoControls({
  video,
  muted,
  onMutedChange
}: {
  video: HTMLVideoElement;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const events = ['durationchange', 'pause', 'play', 'seeked', 'timeupdate'];
      for (const event of events) {
        video.addEventListener(event, notify);
      }
      return () => {
        for (const event of events) {
          video.removeEventListener(event, notify);
        }
      };
    },
    [video]
  );
  const paused = useSyncExternalStore(subscribe, () => video.paused);
  const time = useSyncExternalStore(subscribe, () => video.currentTime);
  const duration = useSyncExternalStore(subscribe, () => video.duration);
  const known = Number.isFinite(duration);
  return (
    <FloatingToolbar className="pointer-events-auto">
      <IconButton
        label={paused ? 'Play video' : 'Pause video'}
        shortcut={shortcutLabel('playPause')}
        onClick={() => togglePlayback(video)}
      >
        {paused ? <Play size={15} /> : <Pause size={15} />}
      </IconButton>
      <span className="min-w-10 text-right tabular-nums">{formatTime(time)}</span>
      <span className="mx-2 flex">
        <Slider
          label="Playback position"
          min={0}
          max={known ? duration : 0}
          step={0.01}
          value={time}
          disabled={!known}
          className="w-64"
          onChange={(value) => seekTo(video, value)}
        />
      </span>
      <span className="min-w-10 tabular-nums">{formatTime(duration)}</span>
      <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => onMutedChange(!muted)}>
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </IconButton>
    </FloatingToolbar>
  );
}
