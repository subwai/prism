import { renderInLibrary } from '#components/__tests__/render';
import { fakeAPI } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useBrowsing } from '#hooks/use-gallery-view';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { Suspense, use, useState } from 'react';
import { expect, test } from 'vitest';

const photo = (name: string): PhotoEntry => ({ id: name, kind: 'image', name, parentId: '.' });
const first = photo('a.jpg');
const entries = [first, photo('b.jpg'), photo('c.jpg'), photo('d.jpg')];

/** Browses the root's photos from the first, stepping twice in one task, as a busy window does. */
function Browser() {
  const library = useLibrary();
  const view = use(library.view({ ...folderSpec('.'), show: 'images' }));
  const [selected, setSelected] = useState(first);
  const browsing = useBrowsing(view, selected, setSelected);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          browsing.step?.(1);
          browsing.step?.(1);
        }}
      >
        Twice
      </button>
      <output data-testid="selected">{`${selected.name} at ${browsing.index}`}</output>
    </>
  );
}

test('steps taken before the last one shows go on from it', async () => {
  const { screen } = await renderInLibrary(
    <Suspense>
      <Browser />
    </Suspense>,
    { api: fakeAPI([], entries) },
  );
  const selected = screen.getByTestId('selected');
  await expect.element(selected).toHaveTextContent('a.jpg at 0');
  await screen.getByRole('button', { name: 'Twice' }).click();
  await expect.element(selected).toHaveTextContent('c.jpg at 2');
});
