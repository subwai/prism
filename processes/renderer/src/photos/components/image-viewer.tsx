import { formatSize } from '#photos/data/entries';
import { resourceURL } from '#photos/data/urls';
import type { clientLoader as originalLoader } from '#routes/resources+/original';
import type { PhotoEntry } from '@app/shared';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

export function Modal({
  children,
  label,
  onClose,
  className = ''
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`preview-dialog ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function ImageViewer({
  entries,
  selected,
  onSelect,
  onClose
}: {
  entries: PhotoEntry[];
  selected: PhotoEntry | null;
  onSelect: (entry: PhotoEntry) => void;
  onClose?: () => void;
}) {
  const [fit, setFit] = useState(true);
  const [playing, setPlaying] = useState(false);
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
      className="image-viewer"
      aria-label="Image preview"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }
        if (event.key === ' ' && event.target === event.currentTarget) {
          event.preventDefault();
          setPlaying(!playing);
        }
      }}
    >
      <header className="viewer-heading">
        <span className="viewer-name">{selected?.name ?? 'Select a photo'}</span>
        <span className="viewer-counter">
          {index === -1 ? '' : `${index + 1} / ${entries.length.toLocaleString()}`}
        </span>
        {onClose && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close preview"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        )}
      </header>
      <div className={`image-stage ${fit ? 'fit' : 'actual'}`}>
        {selected ? (
          <OriginalImage key={selected.id} entry={selected} />
        ) : (
          <p className="empty-caption">Your photos will appear here</p>
        )}
      </div>
      <footer className="viewer-controls">
        <span className="image-details">
          {selected?.metadata ? formatSize(selected.metadata.size) : ''}
        </span>
        <div className="viewer-navigation">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous photo"
            disabled={index <= 0}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={playing ? 'Pause slideshow' : 'Start slideshow'}
            disabled={entries.length < 2}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next photo"
            disabled={index === -1 || index >= entries.length - 1}
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <button
          type="button"
          className="text-button fit-button"
          title={fit ? 'View at actual size' : 'Fit to window'}
          onClick={() => setFit(!fit)}
        >
          {fit ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          {fit ? 'Fit' : '100%'}
        </button>
      </footer>
    </section>
  );
}

function OriginalImage({ entry }: { entry: PhotoEntry }) {
  const original = useFetcher<typeof originalLoader>();
  const { reset } = original;
  useEffect(() => () => reset(), [reset]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const data = original.data?.id === entry.id ? original.data : null;
  const url = data?.url;
  const failed = status === 'error' || (data !== null && !url);
  useEffect(() => {
    if (!data && original.state === 'idle') {
      original.load(resourceURL('original', { id: entry.id }));
    }
  }, [data, entry.id, original]);
  return (
    <>
      {status === 'loading' && !failed && <span className="image-message">Loading photo…</span>}
      {failed ? (
        <div className="image-message">
          <strong>Unable to display this photo</strong>
          <p>The original may be missing or use an unsupported format.</p>
        </div>
      ) : (
        url && (
          <img
            className={status === 'ready' ? '' : 'loading-original'}
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
