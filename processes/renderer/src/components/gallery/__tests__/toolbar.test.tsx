import { renderInLibrary } from '#components/__tests__/render';
import { Toolbar } from '#components/gallery/toolbar';
import { fakeAPI } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { ViewFacets } from '@prism/shared';
import { Suspense, use } from 'react';
import { useSearchParams } from 'react-router';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

/** What the worker counts of two photos by different cameras. */
const FACETS: ViewFacets = {
  fields: {
    camera: [
      { count: 1, value: 'Canon EOS R5' },
      { count: 1, value: 'FUJIFILM X-T5' },
    ],
    format: [{ count: 2, value: 'Photo' }],
    lens: [],
    rating: [],
    tag: [],
  },
  unread: 0,
};

/** The toolbar of a view of the root, once it has opened. */
function ViewToolbar({ onRefresh }: { onRefresh?: () => void }) {
  const library = useLibrary();
  const view = use(library.view(folderSpec('.')));
  return (
    <Toolbar
      trail={[{ id: '.', name: 'Pictures' }]}
      mode="grid"
      view={view}
      refreshes={0}
      onRefresh={onRefresh}
    />
  );
}

/**
 * The URL's search parameters, to see what the toolbar changed. Found by test ID: while
 * suggestions are open, the combobox hides the rest of the page from queries by role.
 */
function Params() {
  const [params] = useSearchParams();
  return <output data-testid="params">{params.toString()}</output>;
}

function renderToolbar(facets = FACETS, options: Parameters<typeof renderInLibrary>[1] = {}) {
  const api = fakeAPI([]);
  api.viewFacets.mockResolvedValue(facets);
  return renderInLibrary(
    <Suspense>
      <ViewToolbar onRefresh={() => null} />
      <Params />
    </Suspense>,
    { api, width: 1400, ...options },
  );
}

test('the search suggests cameras, and choosing one makes it a filter chip', async () => {
  const { screen } = await renderToolbar();
  const output = screen.getByTestId('params');
  const params = () => expect.poll(() => output.element().textContent);
  const search = screen.getByRole('combobox', { name: 'Search current view' });
  await search.click();
  // In use, the search has the worker read the details it suggests soon.
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

test('ratings filter by the fewest stars, which typing ">=" finds', async () => {
  const { screen } = await renderToolbar({
    ...FACETS,
    fields: {
      ...FACETS.fields,
      rating: [
        { count: 1, value: '5' },
        { count: 4, value: '3' },
      ],
    },
  });
  const output = screen.getByTestId('params');
  const params = () => expect.poll(() => output.element().textContent);
  const search = screen.getByRole('combobox', { name: 'Search current view' });
  await search.click();
  await search.fill('>=3');
  await expect.element(screen.getByRole('option', { name: /≥ 3 stars/u })).toBeVisible();
  await expect.element(screen.getByRole('option', { name: /5 stars/u })).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  await params().toMatch(/^suggest=1&rating=3$/u);
  await expect
    .element(screen.getByRole('button', { name: 'Remove Rating: ≥ 3 stars' }))
    .toBeVisible();
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

test('keys typed before the URL has the text before them are kept', async () => {
  // Holds every navigation until released, as a busy machine can for longer than a key press.
  const navigations = { done: Promise.resolve(null) };
  const { screen } = await renderToolbar(FACETS, { loader: () => navigations.done });
  const output = screen.getByTestId('params');
  const search = screen.getByRole('combobox', { name: 'Search current view' });
  await search.click();
  await expect.poll(() => output.element().textContent).toBe('suggest=1');
  const held = Promise.withResolvers<null>();
  navigations.done = held.promise;
  await userEvent.keyboard('canon');
  await expect.element(search).toHaveValue('canon');
  held.resolve(null);
  await expect.poll(() => output.element().textContent).toBe('suggest=1&q=canon');
  await expect.element(search).toHaveValue('canon');
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
  const { screen } = await renderToolbar({
    fields: { camera: [], format: [], lens: [], rating: [], tag: [] },
    unread: 0,
  });
  await screen.getByRole('combobox', { name: 'Search current view' }).click();
  await expect.element(screen.getByText('No photos or videos here to filter')).toBeVisible();
});
