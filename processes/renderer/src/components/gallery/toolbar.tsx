import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import type { ViewMode } from '#data/entries';
import { filterChoices, type FilterField, type PhotoFilter } from '#data/filters';
import type { FolderTrail } from '#data/library';
import { useViewParams } from '#hooks/use-view-params';
import { useShortcut } from '#keyboard/shortcuts';
import {
  Breadcrumbs,
  IconButton,
  SearchField,
  SegmentedControl,
  Select,
  ToolbarGroup,
  Toolbar as WindowToolbar,
} from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpAZ,
  BookOpen,
  Funnel,
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw,
} from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';

const FILTER_LABELS: Record<FilterField, { label: string; any: string }> = {
  camera: { any: 'Any camera', label: 'Camera' },
  lens: { any: 'Any lens', label: 'Lens' },
  tag: { any: 'Any tag', label: 'Tag' },
};

/**
 * A choice of the values `field` takes among `entries`' photos, as their EXIF details are read.
 * The chosen value stays a choice even once no photo shows it, so the view can say so.
 */
function FilterSelect({
  field,
  entries,
  filter,
  onChange,
}: {
  field: FilterField;
  entries: PhotoEntry[];
  filter: PhotoFilter;
  onChange: (field: FilterField, value: string) => void;
}) {
  // New pages and details arrive in the background, so reading them never holds up the keys.
  const deferredEntries = useDeferredValue(entries);
  const choices = useMemo(() => filterChoices(deferredEntries, field), [deferredEntries, field]);
  const chosen = filter[field];
  const values = chosen && !choices.includes(chosen) ? [chosen, ...choices] : choices;
  return (
    <Select
      label={FILTER_LABELS[field].label}
      value={chosen}
      onChange={(value) => onChange(field, value)}
      options={[
        { label: FILTER_LABELS[field].any, value: '' },
        ...values.map((value) => ({ label: value, value })),
      ]}
    />
  );
}

/**
 * The view's toolbar: history, where the folder is, how it sorts and filters, search and the
 * view. It reads and changes the view through the URL; filters offer what the scan's `entries`
 * hold. `refreshes` counts refreshes, and each one spins the refresh icon once.
 */
export function Toolbar({
  trail,
  mode,
  entries,
  refreshes,
  onRefresh,
}: {
  trail: FolderTrail;
  mode: ViewMode;
  entries: PhotoEntry[];
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
          options={[
            { label: 'Name', value: 'name' },
            { label: 'Date Taken', value: 'taken' },
            { label: 'Modified', value: 'modified' },
            { label: 'Created', value: 'created' },
            { label: 'Size', value: 'size' },
          ]}
        />
        <IconButton
          label={view.descending ? 'Sort ascending' : 'Sort descending'}
          onClick={() => view.toggleOrder()}
        >
          {view.descending ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </IconButton>
        <IconButton
          label={view.filter ? 'Hide filters' : 'Filter by camera, lens or tag'}
          pressed={view.filter !== null}
          onClick={() => view.toggleFilters()}
        >
          <Funnel />
        </IconButton>
        {view.filter && (
          <>
            <FilterSelect
              field="camera"
              entries={entries}
              filter={view.filter}
              onChange={(field, value) => view.setFilter(field, value)}
            />
            <FilterSelect
              field="lens"
              entries={entries}
              filter={view.filter}
              onChange={(field, value) => view.setFilter(field, value)}
            />
            <FilterSelect
              field="tag"
              entries={entries}
              filter={view.filter}
              onChange={(field, value) => view.setFilter(field, value)}
            />
          </>
        )}
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
