import { FILTER_FIELDS, filterGroup, type PhotoFilter } from '#data/filters';
import type { GalleryView } from '#data/views/gallery-view';
import { useViewVersion } from '#hooks/use-gallery-view';
import { useViewParams } from '#hooks/use-view-params';
import { useShortcut } from '#keyboard/shortcuts';
import { TokenSearchField } from '@prism/design-system';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

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
export function SearchAndFilters({ gallery }: { gallery: GalleryView | null }) {
  const shortcut = useShortcut();
  const view = useViewParams();
  const [search, setSearch] = useTypedSearch(view.search, view.setSearch);
  // Counted only while the field is in use, and again with each version of the view.
  const version = useViewVersion(gallery);
  const facetsQuery = gallery?.facetsQuery(version);
  const { data: facets } = useQuery({
    ...facetsQuery,
    queryFn: facetsQuery?.queryFn && view.suggesting ? facetsQuery.queryFn : skipToken,
    queryKey: facetsQuery?.queryKey ?? ['view', '', 'facets', 0, ''],
  });
  const reading = !facets || facets.unread > 0;
  const groups = FILTER_FIELDS.map((field) => filterGroup(field, facets?.fields[field] ?? []));
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
