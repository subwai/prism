import type { ScanState } from '#photos/data/directory-scan';
import { THUMBNAIL_SIZE, type ViewMode } from '#photos/data/entries';
import { useShortcutLabel } from '#photos/shortcuts';
import { Slider, StatusBar, StatusIndicator } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { SlidersHorizontal } from 'lucide-react';

export function GalleryStatus({
  mode,
  pending,
  scan,
  count,
  selected,
  size,
  onSize
}: {
  mode: ViewMode;
  /** A navigation or refresh is loading the next view. */
  pending: boolean;
  scan: ScanState;
  count: number;
  selected: PhotoEntry | null;
  size: number;
  onSize: (size: number) => void;
}) {
  let status = `${count.toLocaleString()} ${mode === 'filmstrip' ? 'photos' : 'items'}`;
  if (pending) {
    status = 'Loading…';
  } else if (scan.loading) {
    status = 'Reading folder…';
  }
  const label = useShortcutLabel();
  let hint = 'Arrow keys to browse';
  if (mode === 'grid') {
    const preview = label('preview');
    hint = preview ? `${preview} to preview · Enter to open` : 'Enter to open';
  }
  return (
    <StatusBar>
      <span className="truncate">{selected?.name ?? hint}</span>
      <span className="ml-auto">
        <StatusIndicator busy={pending || scan.loading}>{status}</StatusIndicator>
      </span>
      {mode === 'grid' && (
        <Slider
          label="Thumbnail size"
          icon={<SlidersHorizontal size={13} />}
          min={110}
          max={240}
          step={10}
          value={size}
          defaultValue={THUMBNAIL_SIZE.grid}
          onChange={onSize}
        />
      )}
    </StatusBar>
  );
}
