import { ActivityStatus } from '#components/gallery/activity-status';
import { useShareOffline } from '#data/activity';
import { PAGE_WIDTH, THUMBNAIL_SIZE, type ViewMode } from '#data/entries';
import { useRating } from '#hooks/use-rating';
import { useShortcutLabel } from '#keyboard/shortcuts';
import { Slider, StarRating, StatusBar } from '@prism/design-system';
import type { PhotoEntry, ViewState } from '@prism/shared';
import { MoveHorizontal, SlidersHorizontal } from 'lucide-react';

const COUNTED: Record<ViewMode, string> = { filmstrip: 'photos', grid: 'items', reader: 'pages' };

/**
 * What the status bar says of the view: how many entries it shows, and what it waits for, if
 * anything: the next view, the share, its folder's read, or photos' details.
 */
function statusText(
  mode: ViewMode,
  {
    count,
    loading,
    unread,
    unsupported,
  }: Pick<ViewState, 'count' | 'loading' | 'unread' | 'unsupported'>,
  { offline, pending, reading }: { offline: boolean; pending: boolean; reading: boolean },
) {
  let status = `${count.toLocaleString()} ${COUNTED[mode]}`;
  if (unsupported > 0) {
    // No view shows these, so without it a file the app cannot show would go unnoticed.
    status = `${status} · ${unsupported.toLocaleString()} unsupported ${unsupported === 1 ? 'file' : 'files'}`;
  }
  if (pending) {
    return 'Loading…';
  }
  if (offline) {
    return `${status} · Share offline`;
  }
  if (loading) {
    // Large folders take a while, so say how far the read has got once it has found something.
    return count > 0 ? `${status} so far…` : 'Reading folder…';
  }
  // The order or filters change as details come in, which can take a while on a network share.
  return reading ? `${status} · Reading photo details, ${unread.toLocaleString()} to go` : status;
}

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
  state: Pick<ViewState, 'count' | 'loading' | 'unread' | 'unsupported'>;
  /** The view's order or filters need photos' details, so it says how many are still to read. */
  details?: boolean;
  selected: PhotoEntry | null;
  size: number;
  onSize: (size: number) => void;
}) {
  const { loading, unread } = state;
  // The folder's read and photos' details wait for the share, so the view shows what it has.
  const offline = useShareOffline();
  const reading = details && unread > 0 && !offline;
  const status = statusText(mode, state, { offline, pending, reading });
  const label = useShortcutLabel();
  const rating = useRating(selected);
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
      {/* The filmstrip's viewer rates what it shows already. */}
      {selected && mode === 'grid' && (
        <StarRating
          value={rating.rating}
          onChoose={(stars) => rating.choose(stars)}
          error={rating.error}
        />
      )}
      <span className="ml-auto">
        <ActivityStatus busy={pending || (loading && !offline) || reading}>{status}</ActivityStatus>
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
