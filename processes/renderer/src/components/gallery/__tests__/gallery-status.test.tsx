import { renderInLibrary } from '#components/__tests__/render';
import { GalleryStatus } from '#components/gallery/gallery-status';
import { fakeAPI, tellActivity } from '#data/__tests__/fixtures';
import { IDLE_ACTIVITY } from '@prism/shared';
import { expect, test } from 'vitest';
import type { Locator } from 'vitest/browser';

function status(
  count: number,
  { loading = false, unread = 0, unsupported = 0, details = false } = {},
) {
  return (
    <GalleryStatus
      mode="filmstrip"
      pending={false}
      state={{ count, loading, unread, unsupported }}
      details={details}
      selected={null}
      size={160}
      onSize={() => null}
    />
  );
}

test('a view that has found nothing yet says it is reading the folder', async () => {
  const { screen } = await renderInLibrary(status(0, { loading: true }));
  await expect.element(screen.getByText('Reading folder…')).toBeVisible();
});

test('a view counts what it has found so far', async () => {
  const { screen } = await renderInLibrary(status(1234, { loading: true }));
  await expect.element(screen.getByText('1,234 photos so far…')).toBeVisible();
});

test('a view read to the end shows the total', async () => {
  const { screen } = await renderInLibrary(status(1234, { unread: 5 }));
  await expect.element(screen.getByText('1,234 photos', { exact: true })).toBeVisible();
});

test('a view whose order needs photos’ details says how many are still to read', async () => {
  const { screen } = await renderInLibrary(status(1234, { details: true, unread: 412_000 }));
  await expect
    .element(screen.getByText('1,234 photos · Reading photo details, 412,000 to go'))
    .toBeVisible();
});

test('a view says how many files it cannot show, as no view shows them', async () => {
  const { screen } = await renderInLibrary(status(1234, { unsupported: 1 }));
  await expect.element(screen.getByText('1,234 photos · 1 unsupported file')).toBeVisible();
});

test('a view counts its unsupported files as it reads', async () => {
  const { screen } = await renderInLibrary(status(1234, { loading: true, unsupported: 37 }));
  await expect
    .element(screen.getByText('1,234 photos · 37 unsupported files so far…'))
    .toBeVisible();
});

/**
 * The hint that hovering or focusing the indicator shows, which the browser opens through the
 * indicator's `interestfor`, as nothing in the tests can.
 */
async function hintOf(indicator: Locator) {
  await expect.element(indicator).toHaveAttribute('interestfor');
  const id = indicator.element().getAttribute('interestfor') ?? '';
  const popover = document.querySelector<HTMLElement>(`[id="${id}"]`);
  expect(popover?.getAttribute('popover')).toBe('hint');
  return popover;
}

test('the indicator’s hint says that nothing is running, and the catalog up to date once checked', async () => {
  const api = fakeAPI([]);
  const { screen } = await renderInLibrary(status(1234), { api });
  await expect.element(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
  const hint = await hintOf(screen.getByRole('button', { name: '1,234 photos' }));
  expect(hint?.textContent).not.toContain('up to date');
  expect(hint?.textContent).toContain('FoldersNot checked yet');

  const lastCheck = { complete: true, endedMs: Date.now(), found: 4, fullRead: false, looked: 4 };
  tellActivity(api, { ...IDLE_ACTIVITY, lastCheck });
  await expect.poll(() => hint?.textContent).toContain('Nothing running · catalog up to date');
  expect(hint?.textContent).toContain('FoldersUp to date · checked just now');
});

test('work in the background keeps the indicator busy, and its hint lists the work', async () => {
  const api = fakeAPI([]);
  const { screen } = await renderInLibrary(status(1234), { api });
  tellActivity(api, {
    ...IDLE_ACTIVITY,
    jobs: { ...IDLE_ACTIVITY.jobs, details: { running: 4, waiting: 60 } },
    walk: { found: 43_112, fullRead: false, looked: 12_340 },
  });
  await expect.element(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  // The view's own status stays as it is.
  await expect.element(screen.getByRole('status')).toHaveTextContent('1,234 photos');
  const hint = await hintOf(screen.getByRole('button', { name: '1,234 photos' }));
  expect(hint?.textContent).toContain('Working in the background');
  expect(hint?.textContent).toContain('FoldersChecking · 12,340 of 43,112');
  expect(hint?.textContent).toContain('Photo details4 running · 60 waiting');
  // Every row keeps its place, idle or not, so the hint never changes size.
  expect(hint?.querySelectorAll('li')).toHaveLength(8);

  tellActivity(api, IDLE_ACTIVITY);
  await expect.element(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
});

test('while the share is offline, the status says so and the indicator waits rather than spins', async () => {
  const api = fakeAPI([]);
  const { screen } = await renderInLibrary(
    status(1234, { details: true, loading: true, unread: 5 }),
    {
      api,
    },
  );
  tellActivity(api, {
    ...IDLE_ACTIVITY,
    jobs: { ...IDLE_ACTIVITY.jobs, details: { running: 0, waiting: 64 } },
    offline: true,
  });
  await expect.element(screen.getByText('1,234 photos · Share offline')).toBeVisible();
  await expect.element(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
  const hint = await hintOf(screen.getByRole('button', { name: '1,234 photos · Share offline' }));
  expect(hint?.textContent).toContain('Share offline · showing the catalog');

  // Back: the view's read goes on.
  tellActivity(api, IDLE_ACTIVITY);
  await expect.element(screen.getByText('1,234 photos so far…')).toBeVisible();
  await expect.element(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
});
