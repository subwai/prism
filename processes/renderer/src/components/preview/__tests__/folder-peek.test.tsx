import { fakeFolder } from '#components/__tests__/fake-folder';
import { renderApp } from '#components/__tests__/render';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

// A folder opens once its thumbnails are cached, so each shows whole from its first frame.
vi.mock(import('@prism/shared'), async (importOriginal) => {
  const shared = await importOriginal();
  const { servedThumbnailURL } = await import('#components/__tests__/served-thumbnails');
  return { ...shared, cachedThumbnailURL: servedThumbnailURL(shared.cachedThumbnailURL) };
});

const photo = (name: string, color: string) => ({ color, height: 300, name, width: 400 });

/** A folder with a subfolder inside a subfolder, opened in the grid with the first selected. */
async function openNestedFolder() {
  const app = await renderApp({
    api: fakeFolder([
      {
        children: [
          photo('a.jpg', '#2a5d9f'),
          photo('b.jpg', '#8a6d2f'),
          { children: [photo('c.jpg', '#3f8a4f'), photo('d.jpg', '#9f2a5d')], name: 'Beach' },
        ],
        name: 'Trips',
      },
    ]),
  });
  await app.screen
    .getByRole('listbox', { name: 'Folder contents' })
    .getByRole('option', { name: 'Trips' })
    .click();
  return app;
}

describe('folder cover preview', () => {
  test('Shift-Space shows the cover of the selected folder, and closes it again', async () => {
    const { screen } = await openNestedFolder();
    await userEvent.keyboard('{Shift>}[Space]{/Shift}');
    const sheet = screen.getByRole('dialog', { name: /^[ab]\.jpg$/u });
    await expect.element(sheet.getByText('Cover of Trips')).toBeVisible();
    await expect.element(sheet.getByRole('img')).toBeVisible();
    await userEvent.keyboard('{Shift>}[Space]{/Shift}');
    await expect.element(sheet).not.toBeInTheDocument();
  });
});

describe('folder preview', () => {
  test('moving between folders shows each one whole, never a loading state', async () => {
    const { screen } = await openNestedFolder();
    await userEvent.keyboard('[Space]');
    const sheet = screen.getByRole('dialog', { name: 'Trips' });
    await expect.element(sheet.getByRole('option', { name: 'a.jpg' })).toBeVisible();
    await expect
      .poll(() => sheet.getByRole('option', { name: 'a.jpg' }).element().querySelector('img'))
      .toBeTruthy();
    // Counts every commit that showed the folder loading, or a photo's tile without its image.
    const dialog = sheet.element();
    let gaps = 0;
    const observer = new MutationObserver(() => {
      const loading = dialog.textContent?.includes('Reading folder…');
      const empty = [...dialog.querySelectorAll('[role="option"]')].some(
        (option) =>
          option.getAttribute('aria-label')?.endsWith('.jpg') &&
          !option.querySelector<HTMLImageElement>('img')?.complete,
      );
      if (loading || empty) {
        gaps += 1;
      }
    });
    observer.observe(dialog, { attributes: true, childList: true, subtree: true });
    await sheet.getByRole('option', { name: 'Beach' }).click();
    await userEvent.keyboard('{Enter}');
    await expect
      .element(screen.getByRole('dialog', { name: 'Beach' }).getByRole('option', { name: 'c.jpg' }))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Up in folder preview' }).click();
    await expect.element(sheet.getByRole('option', { name: 'a.jpg' })).toBeVisible();
    observer.disconnect();
    expect(gaps).toBe(0);
  });

  test('browsing photos opened from it leaves the folder still, under the photo', async () => {
    const { screen } = await openNestedFolder();
    await userEvent.keyboard('[Space]');
    const sheet = screen.getByRole('dialog', { name: 'Trips' });
    await sheet.getByRole('option', { name: 'a.jpg' }).click();
    await userEvent.keyboard('{Enter}');
    await expect
      .element(screen.getByRole('dialog', { name: 'a.jpg' }).getByRole('img'))
      .toBeVisible();
    // A view transition draws its snapshots over every dialog, so one here would show the
    // folder's grid over the photo.
    let transitions = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((update) => {
      transitions += 1;
      return start(update);
    }) as typeof document.startViewTransition;
    onTestFinished(() => {
      document.startViewTransition = start;
    });
    await userEvent.keyboard('{ArrowRight}');
    await expect
      .element(screen.getByRole('dialog', { name: 'b.jpg' }).getByRole('img'))
      .toBeVisible();
    await userEvent.keyboard('{ArrowLeft}');
    await expect
      .element(screen.getByRole('dialog', { name: 'a.jpg' }).getByRole('img'))
      .toBeVisible();
    expect(transitions).toBe(0);
  });
});
