import { useEntryMenu, useEntryMenuBelow, useRenameEntry } from '#photos/components/entry-menu';
import { FullScreenButton } from '#photos/components/full-screen-button';
import { Original } from '#photos/components/original';
import { zoomToFit } from '#photos/components/photo-zoom';
import {
  SEEK_SECONDS,
  seekBy,
  togglePlayback,
  VideoControls
} from '#photos/components/video-player';
import { ViewerAnnouncement } from '#photos/components/viewer-announcement';
import { useCommand } from '#photos/hooks/use-command';
import { useContextKey } from '#photos/hooks/use-context-key';
import { useFullScreen } from '#photos/hooks/use-full-screen';
import { useWatching } from '#photos/hooks/use-watching';
import { useShortcut } from '#photos/shortcuts';
import {
  cn,
  EmptyState,
  FloatingControls,
  FloatingToolbar,
  FloatingToolbarDivider,
  IconButton
} from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

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
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  // While focus is inside, browsing is announced, since nothing focused moves to say so.
  const [focused, setFocused] = useState(false);
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
  useCommand('rename', () => active && focused && selected && rename(selected));
  // Opens the menu for what is shown, below it; focus is inside the viewer, so it finds it.
  useCommand('contextMenu', () => {
    if (active && focused && shown) {
      showEntryMenuBelow(shown, () =>
        document.activeElement?.closest('[data-keys~="viewerFocus"]')?.querySelector('img, video')
      );
    }
  });
  const shortcut = useShortcut();

  return (
    // Focusable so the keymap's viewer keys, such as Left and Right, work once it has focus.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={fullScreenRef}
      className="group fullscreen:bg-black relative flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      aria-label="Image preview"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-autofocus={autoFocus || undefined}
      data-keys="viewerFocus"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <ViewerAnnouncement
        focused={focused}
        playing={playing}
        entry={selected}
        index={index}
        count={entries.length}
      />
      {/* Double-clicking to zoom is a pointer shortcut; the keymap and the controls above do the
          same from the keyboard. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          'relative min-h-0 flex-1',
          !fit && !isVideo && 'cursor-grab active:cursor-grabbing'
        )}
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
            // Pausing or seeking, from the controls, a click or the keys, shows the video is being
            // watched. A covered viewer pauses its own video, which is not the same thing.
            onWatch={() => {
              if (active) {
                watch();
              }
            }}
            onEnded={() => {
              if (playing) {
                advance();
              }
            }}
          />
        ) : (
          <EmptyState className="absolute inset-0" description="Your photos will appear here" />
        )}
      </div>
      {/* Controls stay out of the way until the pointer or focus is over the photo. Browsing
          sits at the top, leaving the bottom to a video's own controls. */}
      <FloatingControls position="top">
        <FloatingToolbar label="Photo controls">
          <IconButton
            label="Previous photo"
            shortcut={shortcut('previous')}
            disabled={index <= 0}
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            label={playing ? 'Pause slideshow' : 'Start slideshow'}
            shortcut={shortcut('slideshow')}
            disabled={entries.length < 2}
            onClick={() => onPlayingChange(!playing)}
          >
            {playing ? <Pause /> : <Play />}
          </IconButton>
          <IconButton
            label="Next photo"
            shortcut={shortcut('next')}
            disabled={index === -1 || index >= entries.length - 1}
            onClick={() => move(1)}
          >
            <ChevronRight />
          </IconButton>
          <FloatingToolbarDivider />
          <span className="min-w-14 text-center tabular-nums">
            {index === -1 ? '–' : `${index + 1} / ${entries.length.toLocaleString()}`}
          </span>
          <FloatingToolbarDivider />
          <IconButton
            label={fit ? 'View at actual size' : 'Fit to window'}
            shortcut={shortcut('actualSize')}
            disabled={isVideo}
            onClick={() => toggleFit()}
          >
            {fit ? <Maximize2 /> : <Minimize2 />}
          </IconButton>
          <FullScreenButton fullScreen={fullScreen} onToggle={toggleFullScreen} />
        </FloatingToolbar>
      </FloatingControls>
      {isVideo && video && (
        <FloatingControls position="bottom">
          <VideoControls
            video={video}
            muted={muted}
            onMutedChange={onMutedChange}
            watching={watching}
          />
        </FloatingControls>
      )}
    </section>
  );
}
