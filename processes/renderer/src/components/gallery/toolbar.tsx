import { SearchAndFilters } from '#components/gallery/search-and-filters';
import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import { TrashButton } from '#components/trash/trash-button';
import type { ViewMode } from '#data/entries';
import { narrows } from '#data/filters';
import type { FolderTrail } from '#data/tree/trails';
import type { GalleryView } from '#data/views/gallery-view';
import { useViewParams } from '#hooks/use-view-params';
import { useShortcut } from '#keyboard/shortcuts';
import {
  Breadcrumbs,
  IconButton,
  SegmentedControl,
  Select,
  ToolbarGroup,
  Toolbar as WindowToolbar,
} from '@prism/design-system';
import { SORT_ORDERS, type SortOrder } from '@prism/shared';
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpAZ,
  BookOpen,
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw,
} from 'lucide-react';

const SORT_LABELS: Record<SortOrder, string> = {
  created: 'Created',
  modified: 'Modified',
  name: 'Name',
  size: 'Size',
  taken: 'Date Taken',
};

/**
 * The view's toolbar: history, where the folder is, how it sorts, search and filters, and the
 * view. It reads and changes the view through the URL; filters offer what the worker's `view`
 * holds, `null` while it loads. `refreshes` counts refreshes, and each one spins the refresh
 * icon once.
 */
export function Toolbar({
  trail,
  mode,
  view: gallery,
  refreshes,
  onRefresh,
}: {
  trail: FolderTrail;
  mode: ViewMode;
  view: GalleryView | null;
  refreshes: number;
  /** Missing while the view loads, which leaves nothing to refresh yet. */
  onRefresh?: () => void;
}) {
  const shortcut = useShortcut();
  const navigation = useGalleryNavigation(mode, trail);
  const view = useViewParams();
  return (
    <WindowToolbar>
      <ToolbarGroup>
        <IconButton
          label="Go back"
          shortcut={shortcut('back')}
          disabled={!navigation.back}
          onClick={() => navigation.back?.()}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Go forward"
          shortcut={shortcut('forward')}
          disabled={!navigation.forward}
          onClick={() => navigation.forward?.()}
        >
          <ArrowRight />
        </IconButton>
        <IconButton
          label="Go up"
          shortcut={shortcut('up')}
          disabled={!navigation.up}
          onClick={() => navigation.up?.()}
        >
          <ArrowUp />
        </IconButton>
      </ToolbarGroup>
      <Breadcrumbs
        label="Folder path"
        items={trail.map((folder) => ({ key: folder.id, label: folder.name }))}
        onSelect={(index) => {
          const folder = trail[index];
          if (folder) {
            navigation.open(folder.id);
          }
        }}
      />
      <ToolbarGroup>
        <Select
          label="Sort by"
          value={view.sort}
          onChange={(sort) => view.setSort(sort)}
          options={SORT_ORDERS.map((order) => ({ label: SORT_LABELS[order], value: order }))}
        />
        <IconButton
          label={view.descending ? 'Sort ascending' : 'Sort descending'}
          onClick={() => view.toggleOrder()}
        >
          {view.descending ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </IconButton>
        <IconButton
          label="Refresh folder"
          shortcut={shortcut('refresh')}
          disabled={!onRefresh}
          onClick={onRefresh}
        >
          {/* A new key restarts the animation for every refresh. */}
          <RefreshCw
            key={refreshes}

            className={refreshes > 0 ? 'animate-spin-once' : undefined}
          />
        </IconButton>
      </ToolbarGroup>
      <div className="w-48 shrink-0 @3xl:w-72">
        <SearchAndFilters gallery={gallery} />
      </div>
      {/* Only what a search or filter found: with nothing narrowing, it would be everything. */}
      {(narrows(view.filter) || view.search.trim() !== '') && (
        <TrashButton onClick={() => view.openTrash()} />
      )}
      <SegmentedControl
        label="Gallery view"
        value={mode}
        onChange={(next) => navigation.switchView(next)}
        segments={[
          {
            icon: <Grid2X2 />,
            label: 'Grid view',
            shortcut: shortcut('toggleView'),
            value: 'grid',
          },
          {
            icon: <GalleryHorizontalEnd />,
            label: 'Filmstrip view',
            shortcut: shortcut('toggleView'),
            title: 'Filmstrip · includes subfolders',
            value: 'filmstrip',
          },
          {
            icon: <BookOpen />,
            label: 'Reader view',
            shortcut: shortcut('toggleView'),
            title: 'Reader · photos in this folder only',
            value: 'reader',
          },
        ]}
      />
    </WindowToolbar>
  );
}
