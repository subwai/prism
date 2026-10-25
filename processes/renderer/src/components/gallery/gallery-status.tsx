import type { ScanState } from '#data/directory-scan';
import { PAGE_WIDTH, THUMBNAIL_SIZE, type ViewMode } from '#data/entries';
import { useShortcutLabel } from '#keyboard/shortcuts';
import { Slider, StatusBar, StatusIndicator } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { MoveHorizontal, SlidersHorizontal } from 'lucide-react';

const COUNTED: Record<ViewMode, string> = { filmstrip: 'photos', grid: 'items', reader: 'pages' };

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
  let status = `${count.toLocaleString()} ${COUNTED[mode]}`;
  if (pending) {
    status = 'Loading…';
  } else if (scan.loading) {
    status = 'Reading folder…';
  }
  const label = useShortcutLabel();
  let hint = 'Arrow keys to browse';
  if (mode === 'reader') {
    hint = 'Left and Right to turn pages';
  } else if (mode === 'grid') {
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
      {mode === 'reader' && (
        <Slider
          label="Page width"
          icon={<MoveHorizontal size={13} />}
          min={400}
          max={1600}
          step={50}
          value={size}
          defaultValue={PAGE_WIDTH}
          onChange={onSize}
        />
      )}
    </StatusBar>
  );
}
