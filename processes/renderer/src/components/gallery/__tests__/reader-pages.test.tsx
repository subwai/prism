import { renderInLibrary } from '#components/__tests__/render';
import { Pages } from '#components/gallery/reader-view';
import { fakeAPI } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { Suspense, use } from 'react';
import { expect, test } from 'vitest';
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
