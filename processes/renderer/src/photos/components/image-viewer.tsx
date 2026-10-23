import { useEntryMenu } from '#photos/components/entry-menu';
import { FullScreenButton } from '#photos/components/full-screen-button';
import { Original } from '#photos/components/original';
import { zoomToFit } from '#photos/components/photo-zoom';
import {
  SEEK_SECONDS,
  seekBy,
  togglePlayback,
  VideoControls
} from '#photos/components/video-player';
import { useCommand } from '#photos/hooks/use-command';
import { useContextKey } from '#photos/hooks/use-context-key';
import { useFullScreen } from '#photos/hooks/use-full-screen';
import { useWatching } from '#photos/hooks/use-watching';
import { useShortcutLabel } from '#photos/shortcuts';
import { cn, FloatingToolbar, FloatingToolbarDivider, IconButton } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

const MESSAGE = 'absolute top-1/2 left-1/2 -translate-1/2 text-center text-label-tertiary';

/** Owned by the caller, so the slideshow, the fit and the sound survive switching viewers. */
export interface ViewerState {
  /** Whether the slideshow is running. */
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** Fit to the window, or zoomed in (opening at actual size). */
  fit: boolean;
  onFitChange: (fit: boolean) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}

export function useViewerState(): ViewerState {
  const [playing, setPlaying] = useState(false);
  const [fit, setFit] = useState(true);
  const [muted, setMuted] = useState(false);
  return {
    fit,
    muted,
    onFitChange: setFit,
    onMutedChange: setMuted,
    onPlayingChange: setPlaying,
    playing
  };
}

const HOVER_CONTROLS =
  'pointer-events-none absolute inset-x-0 flex justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100';

export function ImageViewer({
  entries,
  selected,
  onSelect,
  autoFocus = false,
  active = true,
  viewer: { playing, onPlayingChange, fit, onFitChange, muted, onMutedChange }
}: {
  viewer: ViewerState;
  entries: PhotoEntry[];
  selected: PhotoEntry | null;
  onSelect: (entry: PhotoEntry) => void;
  /** Takes focus when its dialog opens, so its keys work without clicking the photo first. */
  autoFocus?: boolean;
  /** Off while something covers the viewer: its video pauses and leaves the keys alone. */
  active?: boolean;
}) {
  const showEntryMenu = useEntryMenu();
  const index = entries.findIndex((entry) => entry.id === selected?.id);
  // The selection moves at once; the photo follows once it has decoded, keeping the previous
  // one on screen meanwhile instead of a placeholder, however fast the arrow keys repeat.
  const shown = useDeferredValue(selected);
  const zoom = useRef<ReactZoomPanPinchContentRef>(null);
  // State rather than a ref, so the controls render once the video element exists.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const isVideo = shown?.kind === 'video';
  const controlling = active && video !== null;
  const { fullScreen, ref: fullScreenRef, toggle: toggleFullScreen } = useFullScreen();
  const { watching, watch } = useWatching(shown, controlling);
  /** Between fit and actual size, zooming in around `point` when there is one. */
  function toggleFit(point?: { clientX: number; clientY: number }) {
    if (isVideo) {
      return;
    }
    onFitChange(!fit);
    if (zoom.current) {
      zoomToFit(zoom.current, !fit, point);
    }
  }
  function move(offset: number) {
    const next = entries[index + offset];
    if (next) {
      onSelect(next);
    }
  }
  function advance() {
    const next = entries[(index + 1) % entries.length];
    if (next) {
      onSelect(next);
    }
  }
  // A slideshow shows each photo for a while, and each video until it ends.
  const timed = playing && entries.length > 1 && selected?.kind !== 'video';
  useEffect(() => {
    if (!timed) {
      return;
    }
    const timer = setInterval(() => {
      const next = entries[(index + 1) % entries.length];
      if (next) {
        onSelect(next);
      }
    }, 3500);
    return () => clearInterval(timer);
  }, [timed, index, entries, onSelect]);
  // A covered viewer must not keep playing under whatever covers it.
  useEffect(() => {
    if (!active) {
      video?.pause();
    }
  }, [active, video]);
  function control(action: (element: HTMLVideoElement) => void) {
    if (controlling) {
      action(video);
    }
  }
  const playPause = () => {
    watch();
    control(togglePlayback);
  };
  const seek = (step: number) => {
    watch();
    control((element) => seekBy(element, step * SEEK_SECONDS));
  };
  const toggleMute = () => control(() => onMutedChange(!muted));
  // Commands reach every viewer; a covered one leaves them to whatever covers it. The keymap
  // decides which keys run them where, from these contexts and `viewerFocus` below.
  useContextKey('viewerShown', active);
  useContextKey('videoShown', controlling);
  useCommand('playPause', playPause);
  useCommand('seekBackward', () => seek(-1));
  useCommand('seekForward', () => seek(1));
  useCommand('mute', toggleMute);
  useCommand('previous', () => active && move(-1));
  useCommand('next', () => active && move(1));
  useCommand('actualSize', () => active && toggleFit());
  useCommand('fullScreen', () => active && toggleFullScreen());
  const label = useShortcutLabel();

  return (
    <section
      ref={fullScreenRef}
      className="group fullscreen:bg-black relative flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      aria-label="Image preview"
      tabIndex={0}
      data-autofocus={autoFocus || undefined}
      data-keys="viewerFocus"
    >
      <div
        className={cn(
          'relative min-h-0 flex-1',
          !fit && !isVideo && 'cursor-grab active:cursor-grabbing'
        )}
        onClick={(event) => event.target instanceof HTMLVideoElement && watch()}
        onDoubleClick={(event) => toggleFit(event)}
        onContextMenu={(event) => shown && showEntryMenu(event, shown)}
      >
        {shown ? (
          <Original
            entry={shown}
            fit={fit}
            zoom={zoom}
            onFitChange={onFitChange}
            video={setVideo}
            autoPlay={active}
            // Videos loop, except in a slideshow, which moves on once each has played.
            loop={!playing}
            muted={muted}
            onEnded={() => {
              if (playing) {
                advance();
              }
            }}
          />
        ) : (
          <p className={MESSAGE}>Your photos will appear here</p>
        )}
      </div>
      {/* Controls stay out of the way until the pointer or focus is over the photo. Browsing
          sits at the top, leaving the bottom to a video's own controls. */}
      <div className={cn(HOVER_CONTROLS, 'top-4')}>
        <FloatingToolbar className="pointer-events-auto">
          <IconButton
            label="Previous photo"
            shortcut={label('previous')}
            disabled={index <= 0}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            label={playing ? 'Pause slideshow' : 'Start slideshow'}
            shortcut={label('slideshow')}
            disabled={entries.length < 2}
            onClick={() => onPlayingChange(!playing)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </IconButton>
          <IconButton
            label="Next photo"
            shortcut={label('next')}
            disabled={index === -1 || index >= entries.length - 1}
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </IconButton>
          <FloatingToolbarDivider />
          <span className="min-w-14 text-center tabular-nums">
            {index === -1 ? '–' : `${index + 1} / ${entries.length.toLocaleString()}`}
          </span>
          <FloatingToolbarDivider />
          <IconButton
            label={fit ? 'View at actual size' : 'Fit to window'}
            shortcut={label('actualSize')}
            disabled={isVideo}
            onClick={() => toggleFit()}
          >
            {fit ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </IconButton>
          <FullScreenButton fullScreen={fullScreen} onToggle={toggleFullScreen} />
        </FloatingToolbar>
      </div>
      {isVideo && video && (
        <div className={cn(HOVER_CONTROLS, 'bottom-4')} onPointerDown={watch}>
          <VideoControls
            video={video}
            muted={muted}
            onMutedChange={onMutedChange}
            watching={watching}
          />
        </div>
      )}
    </section>
  );
}
