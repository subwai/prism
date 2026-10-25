import { useShortcut } from '#keyboard/shortcuts';
import type { ViewMode } from '#photos/data/entries';
import type { FolderTrail } from '#photos/data/library';
import { useGalleryNavigation } from '#photos/hooks/use-gallery-navigation';
import { useViewParams } from '#photos/hooks/use-view-params';
import {
  Breadcrumbs,
  IconButton,
  SearchField,
  SegmentedControl,
  Select,
  ToolbarGroup,
  Toolbar as WindowToolbar
} from '@prism/design-system';
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpAZ,
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw
} from 'lucide-react';

/**
 * The view's toolbar: history, where the folder is, how it sorts, search and the view. It
 * reads and changes the view through the URL; `refreshes` counts refreshes, and each one spins
 * the refresh icon once.
 */
export function Toolbar({
  trail,
  mode,
  refreshes,
  onRefresh
}: {
  trail: FolderTrail;
  mode: ViewMode;
  refreshes: number;
  onRefresh: () => void;
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
          options={[
            { label: 'Name', value: 'name' },
            { label: 'Modified', value: 'modified' },
            { label: 'Created', value: 'created' },
            { label: 'Size', value: 'size' }
          ]}
        />
        <IconButton
          label={view.descending ? 'Sort ascending' : 'Sort descending'}
          onClick={() => view.toggleOrder()}
        >
          {view.descending ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </IconButton>
        <IconButton label="Refresh folder" shortcut={shortcut('refresh')} onClick={onRefresh}>
          {/* A new key restarts the animation for every refresh. */}
          <RefreshCw
            key={refreshes}

            className={refreshes > 0 ? 'animate-spin-once' : undefined}
          />
        </IconButton>
      </ToolbarGroup>
      <div className="w-36 shrink-0 @3xl:w-52">
        <SearchField
          label="Search current view"
          placeholder="Search"
          shortcut={shortcut('find')}
          value={view.search}
          onChange={(search) => view.setSearch(search)}
        />
      </div>
      <SegmentedControl
        label="Gallery view"
        value={mode}
        onChange={(next) => navigation.switchView(next)}
        segments={[
          {
            icon: <Grid2X2 />,
            label: 'Grid view',
            shortcut: shortcut('toggleView'),
            value: 'grid'
          },
          {
            icon: <GalleryHorizontalEnd />,
            label: 'Filmstrip view',
            shortcut: shortcut('toggleView'),
            title: 'Filmstrip · includes subfolders',
            value: 'filmstrip'
          }
        ]}
      />
    </WindowToolbar>
  );
}
