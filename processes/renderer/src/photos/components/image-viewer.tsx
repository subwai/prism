import { CachedValue } from '#photos/components/cached-value';
import { formatSize } from '#photos/data/entries';
import { useLibrary } from '#photos/hooks/use-library';
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
import { useEffect, useState } from 'react';

/** Owned by the caller, so the slideshow and the fit survive switching viewers. */
export interface ViewerState {
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** Fit to the window, or show at actual size. */
  fit: boolean;
  onFitChange: (fit: boolean) => void;
}

export function useViewerState(): ViewerState {
  const [playing, setPlaying] = useState(false);
  const [fit, setFit] = useState(true);
  return { fit, onFitChange: setFit, onPlayingChange: setPlaying, playing };
}

export function ImageViewer({
  entries,
  selected,
  onSelect,
  autoFocus = false,
  viewer: { playing, onPlayingChange, fit, onFitChange }
}: {
  viewer: ViewerState;
  entries: PhotoEntry[];
  selected: PhotoEntry | null;
  onSelect: (entry: PhotoEntry) => void;
  /** Takes focus when its dialog opens, so its keys work without clicking the photo first. */
  autoFocus?: boolean;
}) {
  const index = entries.findIndex((entry) => entry.id === selected?.id);
  function move(offset: number) {
    const next = entries[index + offset];
    if (next) {
      onSelect(next);
    }
  }
  useEffect(() => {
    if (!playing || entries.length < 2) {
      return;
    }
    const timer = setInterval(() => {
      const next = entries[(index + 1) % entries.length];
      if (next) {
        onSelect(next);
      }
    }, 3500);
    return () => clearInterval(timer);
  }, [playing, index, entries, onSelect]);

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
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }
        if (isShiftKey(event, 'F')) {
          event.preventDefault();
          event.stopPropagation();
          onFitChange(!fit);
        }
        if (isShiftKey(event, 'S') && entries.length > 1) {
          event.preventDefault();
          onPlayingChange(!playing);
        }
      }}
    >
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-auto',
          fit
            ? 'flex items-center justify-center p-5 [&>img]:max-h-full [&>img]:max-w-full [&>img]:object-contain [&>img]:shadow-photo'
            : '[&>img]:m-auto [&>img]:block [&>img]:max-w-none'
        )}
      >
        {selected ? (
          <OriginalImage key={selected.id} entry={selected} />
        ) : (
          <p className="text-label-tertiary">Your photos will appear here</p>
        )}
      </div>
      {/* Controls stay out of the way until the pointer or focus is over the photo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
            onClick={() => onFitChange(!fit)}
          >
            {fit ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </IconButton>
        </FloatingToolbar>
      </div>
    </section>
  );
}

const MESSAGE = 'absolute top-1/2 left-1/2 -translate-1/2 text-center text-label-tertiary';

function OriginalImage({ entry }: { entry: PhotoEntry }) {
  const library = useLibrary();
  return (
    <CachedValue
      cached={library.peekOriginal(entry.id)}
      read={() => library.original(entry.id)}
      generation={library.generation}
    >
      {(url) => <OriginalPhoto entry={entry} url={url} />}
    </CachedValue>
  );
}

/** `url` is `undefined` while it resolves and `null` if the original is unavailable. */
function OriginalPhoto({ entry, url }: { entry: PhotoEntry; url: string | null | undefined }) {
  const library = useLibrary();
  const thumbnail = library.peekThumbnail(entry.id)?.value;
  const placeholder = thumbnail?.status === 'ready' ? thumbnail.url : null;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const failed = status === 'error' || url === null;
  return (
    <>
      {/* The grid thumbnail stands in, scaled up, until the original has decoded. */}
      {status === 'loading' &&
        !failed &&
        (placeholder ? (
          <span className="absolute inset-0 p-5">
            <img src={placeholder} alt="" className="size-full object-contain" draggable={false} />
          </span>
        ) : (
          <span className={MESSAGE}>Loading photo…</span>
        ))}
      {failed ? (
        <div className={MESSAGE}>
          <strong className="text-headline font-medium text-label-secondary">
            Unable to display this photo
          </strong>
          <p className="mt-2 leading-relaxed">
            The original may be missing or use an unsupported format.
          </p>
        </div>
      ) : (
        url && (
          <img
            // A photo the browser already decoded is ready before its load event would fire.
            ref={(node) => {
              if (node?.complete && node.naturalWidth > 0) {
                setStatus('ready');
              }
            }}
            className={status === 'ready' ? '' : 'invisible'}
            src={url}
            alt={entry.name}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
            draggable={false}
          />
        )
      )}
    </>
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
      caption={`Photo preview${size}`}
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
