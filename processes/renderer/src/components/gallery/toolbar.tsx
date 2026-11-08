import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import type { ViewMode } from '#data/entries';
import { FILTER_FIELDS, filterChoices, type FilterField, type PhotoFilter } from '#data/filters';
import type { FolderTrail } from '#data/library';
import { useViewParams } from '#hooks/use-view-params';
import { useShortcut } from '#keyboard/shortcuts';
import {
  Breadcrumbs,
  IconButton,
  SegmentedControl,
  Select,
  TokenSearchField,
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
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

const FILTER_LABELS: Record<FilterField, string> = {
  camera: 'Camera',
  format: 'Format',
  lens: 'Lens',
  tag: 'Tag',
};

/** What the search's suggestions say when they have nothing to offer. */
function emptyMessage(reading: boolean, search: string) {
  if (reading) {
    return 'Reading photo details…';
  }
  return search.trim()
    ? `No filters match “${search.trim()}”`
    : 'No photos or videos here to filter';
}

/**
 * The text in the search field, which the URL holds as `search`, and a way to change it.
 *
 * The URL takes a navigation to change, and a key pressed before it lands would otherwise find
 * the field back at the URL's text and be lost. So what is typed shows straight away, and the
 * URL's text replaces it only when it changes for some other reason, such as Back. React
 * Router's `setSearchParams` returns nothing to wait on, so `useOptimistic` can't hold the text
 * until the URL has it.
 */
function useTypedSearch(search: string, setSearch: (search: string) => void) {
  // `seen` is the URL's text as last rendered, and `sent` what was typed since, oldest first.
  const [typed, setTyped] = useState({ seen: search, sent: [] as string[], text: search });
  let current = typed;
  if (search !== typed.seen) {
    const echo = typed.sent.indexOf(search);
    current =
      echo === -1
        ? { seen: search, sent: [], text: search }
        : { ...typed, seen: search, sent: typed.sent.slice(echo + 1) };
    setTyped(current);
  }
  return [
    current.text,
    (text: string) => {
      setTyped((previous) => ({ ...previous, sent: [...previous.sent, text], text }));
      setSearch(text);
    },
  ] as const;
}

/**
 * The view's search, which also filters by format, camera, lens and tag: it suggests the values
 * found among `entries`, photos' as their EXIF details are read, and a chosen one becomes a
 * chip. The scan reads those details while the field is in use, so it has values to suggest;
 * `reading` says it is still at it.
 */
function SearchAndFilters({ entries, reading }: { entries: PhotoEntry[]; reading: boolean }) {
  const shortcut = useShortcut();
  const view = useViewParams();
  const [search, setSearch] = useTypedSearch(view.search, view.setSearch);
  // New pages and details arrive in the background, so reading them never holds up the keys.
  const deferredEntries = useDeferredValue(entries);
  const groups = useMemo(
    () =>
      FILTER_FIELDS.map((field) => ({
        field,
        label: FILTER_LABELS[field],
        values: filterChoices(deferredEntries, field),
      })),
    [deferredEntries],
  );
  return (
    <TokenSearchField
      label="Search current view"
      placeholder="Search or filter"
      shortcut={shortcut('find')}
      query={search}
      onQueryChange={setSearch}
      tokens={FILTER_FIELDS.flatMap((field) =>
        view.filter[field].map((value) => ({ field, value })),
      )}
      onTokensChange={(tokens) =>
        view.setFilter(
          Object.fromEntries(
            FILTER_FIELDS.map((field) => [
              field,
              tokens.filter((token) => token.field === field).map((token) => token.value),
            ]),
          ) as PhotoFilter,
        )
      }
      groups={groups}
      empty={emptyMessage(reading, search)}
      onFocus={() => view.suggestFilters(true)}
      onBlur={() => view.suggestFilters(false)}
    />
  );
}

/**
 * The view's toolbar: history, where the folder is, how it sorts, search and filters, and the
 * view. It reads and changes the view through the URL; filters offer what the scan's `entries`
 * hold, while `reading` says the scan is still listing them or reading their details.
 * `refreshes` counts refreshes, and each one spins the refresh icon once.
 */
export function Toolbar({
  trail,
  mode,
  entries,
  reading = true,
  refreshes,
  onRefresh,
}: {
  trail: FolderTrail;
  mode: ViewMode;
  entries: PhotoEntry[];
  reading?: boolean;
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
        <SearchAndFilters entries={entries} reading={reading} />
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
