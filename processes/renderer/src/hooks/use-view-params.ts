import type { SortOrder } from '#data/entries';
import { FILTER_FIELDS, type FilterField, FILTERS_SHOWN, photoFilter } from '#data/filters';
import { sortOrder } from '#data/urls';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

/** The search parameter that holds what the view is narrowed to. */
const SEARCH = 'q';

/** Marks the history entry a preview opened, so closing it goes back to where it was. */
interface PreviewOpened {
  previewOpened: true;
}

function opened(state: unknown): state is PreviewOpened {
  return typeof state === 'object' && state !== null && 'previewOpened' in state;
}

/**
 * The view as the URL holds it, and ways to change it: what a search narrows the folder to,
 * how it sorts, which entry is previewed, as whose cover, and whether a slideshow runs. Opening a preview is a
 * step in history, so Back closes it; every other change replaces the current step.
 */
export function useViewParams() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  function update(
    changes: Record<string, string | null>,
    { push = false, state = location.state as unknown } = {},
  ) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [name, value] of Object.entries(changes)) {
          if (value) {
            next.set(name, value);
          } else {
            next.delete(name);
          }
        }
        return next;
      },
      { preventScrollReset: true, replace: !push, state },
    );
  }
  const preview = params.get('preview');
  const cover = params.get('cover');
  const slideshow = params.has('slideshow');
  return {
    closePreview() {
      if (opened(location.state)) {
        navigate(-1);
      } else {
        update({ cover: null, preview: null, slideshow: null });
      }
    },
    /** The folder whose cover the preview shows, if it shows one. */
    cover,
    descending: params.get('order') === 'desc',
    /** What the view is narrowed to, or `null` while its filters are hidden. */
    filter: photoFilter(params),
    /**
     * Opens a preview of `id`, with a slideshow running if `play`, or as the cover of the
     * folder `coverOf`.
     */
    openPreview(id: string, { play = false, coverOf = null as string | null } = {}) {
      const state: PreviewOpened = { previewOpened: true };
      update({ cover: coverOf, preview: id, slideshow: play ? '1' : null }, { push: true, state });
    },
    params,
    preview,
    search: params.get(SEARCH) ?? '',
    /** Narrows the view to photos whose `field` is `value`, or lets any through if empty. */
    setFilter: (field: FilterField, value: string) => update({ [field]: value }),
    setSearch: (value: string) => update({ [SEARCH]: value }),
    setSlideshow: (running: boolean) => update({ slideshow: running ? '1' : null }),
    setSort: (value: SortOrder) => update({ sort: value }),
    /** Moves the open preview to `id`, as browsing inside it does. */
    showPreview: (id: string) => update({ cover: null, preview: id }),
    slideshow,
    sort: sortOrder(params),
    /** Shows the filters, or hides them and lets every photo through again. */
    toggleFilters() {
      update(
        params.has(FILTERS_SHOWN)
          ? Object.fromEntries([FILTERS_SHOWN, ...FILTER_FIELDS].map((name) => [name, null]))
          : { [FILTERS_SHOWN]: '1' },
      );
    },
    toggleOrder: () => update({ order: params.get('order') === 'desc' ? 'asc' : 'desc' }),
  };
}
