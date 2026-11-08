import { renderInLibrary } from '#components/__tests__/render';
import { Toolbar } from '#components/gallery/toolbar';
import type { PhotoEntry } from '@prism/shared';
import { useSearchParams } from 'react-router';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

const entries: PhotoEntry[] = [
  { exif: { camera: 'FUJIFILM X-T5' }, id: 'a.jpg', kind: 'image', name: 'a.jpg', parentId: '.' },
  { exif: { camera: 'Canon EOS R5' }, id: 'b.jpg', kind: 'image', name: 'b.jpg', parentId: '.' },
];

/**
 * The URL's search parameters, to see what the toolbar changed. Found by test ID: while
 * suggestions are open, the combobox hides the rest of the page from queries by role.
 */
function Params() {
  const [params] = useSearchParams();
  return <output data-testid="params">{params.toString()}</output>;
}

function renderToolbar() {
  return renderInLibrary(
    <>
      <Toolbar
        trail={[{ id: '.', name: 'Pictures' }]}
        mode="grid"
        entries={entries}
        refreshes={0}
        onRefresh={() => null}
      />
      <Params />
    </>,
    { width: 1400 },
  );
}

test('the search suggests cameras, and choosing one makes it a filter chip', async () => {
  const { screen } = await renderToolbar();
  const output = screen.getByTestId('params');
  const params = () => expect.poll(() => output.element().textContent);
  const search = screen.getByRole('combobox', { name: 'Search current view' });
  await search.click();
  // In use, the search has the scan read the details it suggests.
  await params().toMatch(/suggest=1/u);
  await search.fill('can');
  await params().toMatch(/q=can/u);
  const option = screen.getByRole('option', { name: /Canon EOS R5/u });
  await expect.element(option).toBeVisible();
  await expect.element(screen.getByRole('option', { name: /FUJIFILM/u })).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  // The chip takes the place of what was typed to find it.
  await params().toMatch(/^suggest=1&camera=Canon\+EOS\+R5$/u);
  const remove = screen.getByRole('button', { name: 'Remove Camera: Canon EOS R5' });
  await expect.element(remove).toBeVisible();
  await remove.click();
  await params().not.toMatch(/camera=/u);
});

test('with nothing typed, the list offers fields, and opening one lists its values', async () => {
  const { screen } = await renderToolbar();
  const output = screen.getByTestId('params');
  const params = () => expect.poll(() => output.element().textContent);
  const search = screen.getByRole('combobox', { name: 'Search current view' });
  await search.click();
  await expect.element(screen.getByRole('option', { name: /Format/u })).toBeVisible();
  await expect.element(screen.getByRole('option', { name: /Canon/u })).not.toBeInTheDocument();
  await screen.getByRole('option', { name: /Camera/u }).click();
  await expect.element(screen.getByRole('option', { name: /Format/u })).not.toBeInTheDocument();
  // Typing narrows the open field's values.
  await search.fill('fuji');
  await expect.element(screen.getByRole('option', { name: /Canon/u })).not.toBeInTheDocument();
  await screen.getByRole('option', { name: /FUJIFILM X-T5/u }).click();
  // Choosing what typing found closes the list, but keeps the field in use.
  await params().toMatch(/^suggest=1&camera=FUJIFILM\+X-T5$/u);
  await expect.element(screen.getByRole('option', { name: /Camera/u })).not.toBeInTheDocument();
  // Opened again, it starts from the fields; choosing without typing keeps the field open.
  await search.click();
  await screen.getByRole('option', { name: /Camera/u }).click();
  await screen.getByRole('option', { name: /Canon EOS R5/u }).click();
  await params().toMatch(/camera=FUJIFILM\+X-T5&camera=Canon\+EOS\+R5$/u);
  await expect.element(screen.getByRole('option', { name: /FUJIFILM X-T5/u })).toBeVisible();
  await screen.getByRole('option', { name: /Camera/u }).click();
  await expect.element(screen.getByRole('option', { name: /Format/u })).toBeVisible();
});

test('typed text stays a search once the field is left, and so do chosen filters', async () => {
  const { screen } = await renderToolbar();
  const output = screen.getByTestId('params');
  const params = () => expect.poll(() => output.element().textContent);
  const search = screen.getByRole('combobox', { name: 'Search current view' });
  // As ⌘F does, then typing key by key.
  (search.element() as HTMLInputElement).focus();
  await userEvent.keyboard('canon');
  await expect.element(screen.getByRole('option', { name: /Canon EOS R5/u })).toBeVisible();
  await userEvent.keyboard('{Enter}');
  await params().toMatch(/^suggest=1&camera=Canon\+EOS\+R5$/u);
  await search.fill('a.jpg');
  await userEvent.keyboard('{Escape}');
  await userEvent.tab();
  await params().toMatch(/^camera=Canon\+EOS\+R5&q=a\.jpg$/u);
  await expect.element(search).toHaveValue('a.jpg');
});

test('Backspace in an empty search leaves an open field, then removes the last chip', async () => {
  const { screen } = await renderToolbar();
  const output = screen.getByTestId('params');
  const params = () => expect.poll(() => output.element().textContent);
  await screen.getByRole('combobox', { name: 'Search current view' }).click();
  await screen.getByRole('option', { name: /Format/u }).click();
  await screen.getByRole('option', { name: /Photo/u }).click();
  await params().toMatch(/format=Photo/u);
  await userEvent.keyboard('{Backspace}');
  await expect.element(screen.getByRole('option', { name: /Camera/u })).toBeVisible();
  await params().toMatch(/format=Photo/u);
  await userEvent.keyboard('{Backspace}');
  await params().not.toMatch(/format=/u);
});

test('with nothing to filter by, the suggestions say so rather than not opening', async () => {
  const { screen } = await renderInLibrary(
    <Toolbar
      trail={[{ id: '.', name: 'Pictures' }]}
      mode="grid"
      entries={[{ id: 'Trips', kind: 'directory', name: 'Trips', parentId: '.' }]}
      reading={false}
      refreshes={0}
    />,
    { width: 1400 },
  );
  await screen.getByRole('combobox', { name: 'Search current view' }).click();
  await expect.element(screen.getByText('No photos or videos here to filter')).toBeVisible();
});
