import type { SortOrder } from '#data/entries';
import { FILTER_FIELDS, type PhotoFilter, photoFilter, SUGGESTING } from '#data/filters';
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
 * Changes to the URL's search parameters: a list replaces every value of its parameter, and an
 * empty value removes it.
 */
type Changes = Record<string, string | string[] | null>;

function applyChanges(params: URLSearchParams, changes: Changes) {
  const next = new URLSearchParams(params);
  for (const [name, value] of Object.entries(changes)) {
    if (Array.isArray(value)) {
      next.delete(name);
      for (const item of value) {
        next.append(name, item);
      }
    } else if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
  }
  return next;
}

/**
 * Changes made in the same task, which apply together. React Router applies each change to the
 * URL as it last rendered, so of two made at once, such as choosing a filter and clearing the
 * text that found it, only the last would stick.
 */
let pending: { changes: Changes; push: boolean; state: unknown } | null = null;

/**
 * The view as the URL holds it, and ways to change it: what a search and filters narrow the folder to,
 * how it sorts, which entry is previewed, as whose cover, and whether a slideshow runs. Opening a preview is a
 * step in history, so Back closes it; every other change replaces the current step.
 */
export function useViewParams() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  function update(changes: Changes, { push = false, state = location.state as unknown } = {}) {
    if (pending) {
      Object.assign(pending.changes, changes);
      pending.push ||= push;
      pending.state = state;
      return;
    }
    const batch = { changes: { ...changes }, push, state };
    pending = batch;
    queueMicrotask(() => {
      pending = null;
      setParams((previous) => applyChanges(previous, batch.changes), {
        preventScrollReset: true,
        replace: !batch.push,
        state: batch.state,
      });
    });
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
    /** What the view is narrowed to. */
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
    /** Narrows the view to the photos `filter` lets through. */
    setFilter: (filter: PhotoFilter) =>
      update(Object.fromEntries(FILTER_FIELDS.map((field) => [field, filter[field]]))),
    setSearch: (value: string) => update({ [SEARCH]: value }),
    setSlideshow: (running: boolean) => update({ slideshow: running ? '1' : null }),
    setSort: (value: SortOrder) => update({ sort: value }),
    /** Moves the open preview to `id`, as browsing inside it does. */
    showPreview: (id: string) => update({ cover: null, preview: id }),
    slideshow,
    sort: sortOrder(params),
    /** Has the worker read soon what filters the search can suggest, while `suggesting`. */
    suggestFilters(suggesting: boolean) {
      if (params.has(SUGGESTING) !== suggesting) {
        update({ [SUGGESTING]: suggesting ? '1' : null });
      }
    },
    /** Whether the search field is in use, so it suggests filters. */
    suggesting: params.has(SUGGESTING),
    toggleOrder: () => update({ order: params.get('order') === 'desc' ? 'asc' : 'desc' }),
  };
}
