import { Original } from '#photos/components/original';
import { zoomToFit } from '#photos/components/photo-zoom';
import {
  SEEK_SECONDS,
  seekBy,
  togglePlayback,
  VideoControls
} from '#photos/components/video-player';
import { formatSize } from '#photos/data/entries';
import { showEntryMenu } from '#photos/entry-menu';
import { useCommand } from '#photos/hooks/use-command';
import { useShiftKey } from '#photos/hooks/use-shift-key';
import { isShiftKey, shortcutLabel } from '#photos/shortcuts';
import {
  cn,
  FloatingToolbar,
  FloatingToolbarDivider,
  IconButton,
  PreviewSheet
} from '@app/design-system';
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
  const index = entries.findIndex((entry) => entry.id === selected?.id);
  // The selection moves at once; the photo follows once it has decoded, keeping the previous
  // one on screen meanwhile instead of a placeholder, however fast the arrow keys repeat.
  const shown = useDeferredValue(selected);
  const zoom = useRef<ReactZoomPanPinchContentRef>(null);
  // State rather than a ref, so the controls render once the video element exists.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const isVideo = shown?.kind === 'video';
  const controlling = active && video !== null;
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
  const playPause = () => control(togglePlayback);
  const seekBackward = () => control((element) => seekBy(element, -SEEK_SECONDS));
  const seekForward = () => control((element) => seekBy(element, SEEK_SECONDS));
  useShiftKey(' ', playPause, controlling);
  useShiftKey('ArrowLeft', seekBackward, controlling);
  useShiftKey('ArrowRight', seekForward, controlling);
  useCommand('play-pause', playPause);
  useCommand('seek-backward', seekBackward);
  useCommand('seek-forward', seekForward);

  return (
    <section
      className="group relative flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      aria-label="Image preview"
      tabIndex={0}
      data-autofocus={autoFocus || undefined}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        // With Shift, Left and Right skip through a video instead.
        if (!event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          event.stopPropagation();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }
        if (isShiftKey(event, 'F')) {
          event.preventDefault();
          event.stopPropagation();
          toggleFit();
        }
        if (isShiftKey(event, 'S') && entries.length > 1) {
          event.preventDefault();
          onPlayingChange(!playing);
        }
      }}
    >
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
      {/* Controls stay out of the way until the pointer or focus is over the photo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {isVideo && video && (
          <VideoControls video={video} muted={muted} onMutedChange={onMutedChange} />
        )}
        <FloatingToolbar className="pointer-events-auto">
          <IconButton label="Previous photo" disabled={index <= 0} onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            label={playing ? 'Pause slideshow' : 'Start slideshow'}
            shortcut={shortcutLabel('slideshow')}
            disabled={entries.length < 2}
            onClick={() => onPlayingChange(!playing)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </IconButton>
          <IconButton
            label="Next photo"
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
            shortcut={shortcutLabel('actualSize')}
            disabled={isVideo}
            onClick={() => toggleFit()}
          >
            {fit ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </IconButton>
        </FloatingToolbar>
      </div>
    </section>
  );
}

/** A photo in a preview sheet, browsable with the arrow keys. */
export function PhotoPeek({
  entries,
  selected,
  onSelect,
  onClose,
  viewer
}: {
  entries: PhotoEntry[];
  selected: PhotoEntry;
  onSelect: (entry: PhotoEntry) => void;
  onClose: () => void;
  viewer: ViewerState;
}) {
  const size = selected.metadata ? ` · ${formatSize(selected.metadata.size)}` : '';
  return (
    <PreviewSheet
      label={selected.name}
      title={selected.name}
      caption={`${selected.kind === 'video' ? 'Video' : 'Photo'} preview${size}`}
      size="large"
      onClose={onClose}
    >
      <ImageViewer
        entries={entries}
        selected={selected}
        onSelect={onSelect}
        viewer={viewer}
        autoFocus
      />
    </PreviewSheet>
  );
}
