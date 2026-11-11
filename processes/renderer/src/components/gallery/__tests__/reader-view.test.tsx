import { renderApp, renderInLibrary, skippableTimers } from '#components/__tests__/render';
import { Pages } from '#components/gallery/reader-view';
import { SLIDE_MS } from '#components/viewer/use-slideshow-timer';
import { fakeAPI } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { Suspense, use } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

/** A landscape photo, much shorter than the portrait page the reader expects until it loads. */
async function landscape() {
  const canvas = new OffscreenCanvas(500, 200);
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'steelblue';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return URL.createObjectURL(await canvas.convertToBlob());
}

const entries: PhotoEntry[] = Array.from({ length: 10 }, (_entry, index) => ({
  id: `page-${index}.png`,
  kind: 'image',
  name: `page-${index}.png`,
  parentId: '.',
}));

/** The reader's pages of the root's photos, once their view has opened. */
function RootPages() {
  const library = useLibrary();
  const view = use(library.view({ ...folderSpec('.'), show: 'images' }));
  return <Pages view={view} width={800} onPage={() => null} />;
}

/** The rendered pages with space between them and the next, as `index: pixels`. */
function gaps(reader: Element) {
  const pages = [...reader.querySelectorAll<HTMLElement>('[data-index]')].toSorted(
    (above, below) => Number(above.dataset.index) - Number(below.dataset.index),
  );
  return pages.flatMap((page, at) => {
    const { bottom } = page.getBoundingClientRect();
    const gap = Math.round((pages[at + 1]?.getBoundingClientRect().top ?? bottom) - bottom);
    return gap === 0 ? [] : [`${page.dataset.index}: ${gap}`];
  });
}

test('pages that come into view while turning sit right below each other', async () => {
  const api = fakeAPI([], entries);
  api.getOriginalURL.mockResolvedValue(await landscape());
  const { library, screen } = await renderInLibrary(
    <Suspense>
      <RootPages />
    </Suspense>,
    { api },
  );
  // Every photo already read, so pages that come into view while turning show at their size.
  await Promise.all(
    entries.map(async (entry) => {
      const release = library.want(entry.id);
      await library.queries.fetchQuery(library.originalQuery(entry));
      release();
    }),
  );
  const reader = screen.getByRole('region', { name: 'Pages' });
  await expect.element(reader).toHaveFocus();
  const counter = screen.getByText(/^\d+ \/ 10$/u);
  for (let page = 2; page <= entries.length; page += 1) {
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(counter).toHaveTextContent(`${page} / 10`);
    await expect.poll(() => gaps(reader.element())).toEqual([]);
  }
});

async function openReader() {
  const { screen } = await renderApp();
  await screen.getByRole('button', { name: 'Reader view' }).click();
  const reader = screen.getByRole('region', { name: 'Pages' });
  await expect.element(reader.getByRole('img', { name: 'small.jpg' })).toBeInTheDocument();
  return { reader: reader.element() as HTMLElement, screen };
}

/** How far the reader has scrolled, and where page `index` starts in it. */
function readerScroll(reader: HTMLElement, index: number) {
  return {
    start:
      (reader.querySelector(`[data-index="${index}"]`)?.getBoundingClientRect().top ?? Number.NaN) -
      reader.getBoundingClientRect().top +
      reader.scrollTop,
    top: reader.scrollTop,
  };
}

/** Where page `index` sits below the top of the reader, to the nearest pixel. */
function belowTop(reader: HTMLElement, index: number) {
  const { start, top } = readerScroll(reader, index);
  return Math.round(start - top);
}

describe('the reader', () => {
  test('shows the photos, and Left and Right turn its pages', async () => {
    const { reader, screen } = await openReader();
    // Photos only, with nothing to select: no videos, folders or options.
    await expect
      .poll(() =>
        [...reader.querySelectorAll('img:not([alt=""])')].map((image) => image.getAttribute('alt')),
      )
      .toEqual(['landscape.jpg', 'portrait.jpg', 'small.jpg']);
    expect(reader.querySelectorAll('[role=option], [aria-selected]')).toHaveLength(0);
    // It takes focus from the view switch, which went with the grid, so the keys work at once.
    await expect.element(reader).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => belowTop(reader, 1)).toBe(0);
    await expect.element(screen.getByText('portrait.jpg', { exact: true })).toBeVisible();
    await userEvent.keyboard('{ArrowLeft}');
    await expect.poll(() => readerScroll(reader, 0).top).toBe(0);

    // Down scrolls a little, as it does in a browser, rather than turning the page.
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => readerScroll(reader, 1).top).toBeGreaterThan(0);
    const { start, top } = readerScroll(reader, 1);
    expect(top).toBeLessThan(start);
  });

  test('a slideshow turns a page at a time', async () => {
    const { reader, screen } = await openReader();
    skippableTimers();
    await screen.getByRole('button', { name: 'Start slideshow' }).click();
    await vi.advanceTimersByTimeAsync(SLIDE_MS);
    await expect.poll(() => belowTop(reader, 1)).toBe(0);
    await screen.getByRole('button', { name: 'Pause slideshow' }).click();
    await expect.element(screen.getByRole('button', { name: 'Start slideshow' })).toBeVisible();
  });
});
