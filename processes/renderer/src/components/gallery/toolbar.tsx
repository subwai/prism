import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import type { ViewMode } from '#data/entries';
import { FILTER_FIELDS, type FilterField, type PhotoFilter } from '#data/filters';
import type { GalleryView } from '#data/gallery-view';
import { ratingFilterLabel, ratingFilterSection } from '#data/ratings';
import type { FolderTrail } from '#data/trails';
import { useViewVersion } from '#hooks/use-gallery-view';
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
import { SORT_ORDERS, type SortOrder } from '@prism/shared';
import { skipToken, useQuery } from '@tanstack/react-query';
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
import { useState } from 'react';

const SORT_LABELS: Record<SortOrder, string> = {
  created: 'Created',
  modified: 'Modified',
  name: 'Name',
  size: 'Size',
  taken: 'Date Taken',
};

const FILTER_LABELS: Record<FilterField, string> = {
  camera: 'Camera',
  format: 'Format',
  lens: 'Lens',
  rating: 'Rating',
  tag: 'Tag',
};

/** How each field's values read, where they are not shown as they are. */
const FILTER_VALUE_LABELS: Partial<Record<FilterField, (value: string) => string>> = {
  rating: ratingFilterLabel,
};

/** The sections a field's values are listed in, for fields that have them. */
const FILTER_SECTIONS: Partial<Record<FilterField, (value: string) => string | undefined>> = {
  rating: ratingFilterSection,
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
 * The view's search, which also filters by format, rating, camera, lens and tag: it suggests the values
 * the folder's photos have, counted by the worker, and a chosen one becomes a chip. The worker
 * reads photos' EXIF details soon while the field is in use, so it has values to suggest, and
 * counts them again as it does. Until the view has loaded, there is nothing to suggest.
 */
function SearchAndFilters({ gallery }: { gallery: GalleryView | null }) {
  const shortcut = useShortcut();
  const view = useViewParams();
  const [search, setSearch] = useTypedSearch(view.search, view.setSearch);
  // Counted only while the field is in use, and again with each version of the view.
  const version = useViewVersion(gallery);
  const facetsQuery = gallery?.facetsQuery(version);
  const { data: facets } = useQuery({
    // The last counts of the same view show while the next are counted.
    placeholderData: (previous, query) => {
      const [, viewId] = query?.queryKey ?? [];
      return viewId === gallery?.viewId ? previous : undefined;
    },
    queryFn: facetsQuery?.queryFn && view.suggesting ? facetsQuery.queryFn : skipToken,
    queryKey: facetsQuery?.queryKey ?? ['view', '', 'facets', 0],
  });
  const reading = !facets || facets.unread > 0;
  const groups = FILTER_FIELDS.map((field) => ({
    field,
    format: FILTER_VALUE_LABELS[field],
    label: FILTER_LABELS[field],
    section: FILTER_SECTIONS[field],
    values: facets?.fields[field] ?? [],
  }));
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
