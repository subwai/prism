import {
  isSilent,
  setViewerPreferences,
  toggleMuted,
  useViewerPreferences,
} from '#data/viewer-preferences';
import { useShortcut, useShortcutLabel } from '#keyboard/shortcuts';
import {
  cn,
  FloatingToolbar,
  FloatingToolbarDivider,
  IconButton,
  Slider,
} from '@prism/design-system';
import type { Command } from '@prism/keybindings';
import { Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useSyncExternalStore } from 'react';

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
/** Off, low or high, as macOS shows the volume. */
function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) {
    return <VolumeX />;
  }
  return volume < 0.5 ? <Volume1 /> : <Volume2 />;
}

/** Playback controls for `video`, which stays the source of truth for its own state. */
export function VideoControls({
  video,
  watching,
}: {
  video: HTMLVideoElement;
  /** Left and Right seek rather than browse, which the controls point out. */
  watching: boolean;
}) {
  const label = useShortcutLabel();
  const shortcut = useShortcut();
  const preferences = useViewerPreferences();
  const silent = isSilent(preferences);
  const volume = silent ? 0 : preferences.volume;
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
    <FloatingToolbar
      label="Video controls"
      className="volume-open:translate-x-12 ease-swift transition-transform duration-300 motion-reduce:transition-none"
    >
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
      {/* The slider slides out to the right of the mute button while the pointer is over
          either, or either has keyboard focus. The toolbar is centred, so it moves right by
          half of what it gains, which keeps the button still under the pointer. Rounded at the
          end as the button would be, which it passes on to the button while closed. */}
      <span
        data-volume
        className="volume-open:rounded-e-control! rounded-e-control flex items-center"
      >
        <IconButton
          label={silent ? 'Unmute' : 'Mute'}
          shortcut={shortcut('mute')}
          className="rounded-e-[inherit]"
          onClick={toggleMuted}
        >
          <VolumeIcon volume={volume} />
        </IconButton>
        {/* Clipped across but not down, where the slider's thumb stands out from its bar. */}
        <span className="volume-open:w-24 ease-swift flex w-0 overflow-x-clip transition-[width] duration-300 motion-reduce:transition-none">
          <span className="flex pr-2.5 pl-1.5">
            <Slider
              label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              valueText={`${Math.round(volume * 100)}%`}
              className="w-20"
              onChange={(value) => setViewerPreferences({ muted: false, volume: value })}
            />
          </span>
        </span>
      </span>
      {hint && (
        // Laid out from the start, collapsed, so its arrows and ⇧, which come from a fallback
        // font, are found before it opens. It opens on a spring, stretching the toolbar out
        // past its new width before settling back. Collapsed, it is inert: out of reach of
        // screen readers, and not the toolbar's end, so the volume control rounds off the pill.
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
