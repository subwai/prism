import { PAGE_WIDTH, THUMBNAIL_SIZE, type ViewMode } from '#data/entries';
import { useShortcutLabel } from '#keyboard/shortcuts';
import { Slider, StatusBar, StatusIndicator } from '@prism/design-system';
import type { PhotoEntry, ViewState } from '@prism/shared';
import { MoveHorizontal, SlidersHorizontal } from 'lucide-react';

const COUNTED: Record<ViewMode, string> = { filmstrip: 'photos', grid: 'items', reader: 'pages' };

export function GalleryStatus({
  mode,
  pending,
  state,
  details = false,
  selected,
  size,
  onSize,
}: {
  mode: ViewMode;
  /** A navigation or refresh is loading the next view. */
  pending: boolean;
  state: Pick<ViewState, 'count' | 'loading' | 'unread'>;
  /** The view's order or filters need photos' details, so it says how many are still to read. */
  details?: boolean;
  selected: PhotoEntry | null;
  size: number;
  onSize: (size: number) => void;
}) {
  const { count, loading, unread } = state;
  const reading = details && unread > 0;
  let status = `${count.toLocaleString()} ${COUNTED[mode]}`;
  if (pending) {
    status = 'Loading…';
  } else if (loading) {
    // Large folders take a while, so say how far the read has got once it has found something.
    status = count > 0 ? `${status} so far…` : 'Reading folder…';
  } else if (reading) {
    // The order or filters change as details come in, which can take a while on a network share.
    status = `${status} · Reading photo details, ${unread.toLocaleString()} to go`;
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
        <StatusIndicator busy={pending || loading || reading}>{status}</StatusIndicator>
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
