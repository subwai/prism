import { fakeFolder, PHOTOS } from '#components/__tests__/fake-folder';
import { renderApp } from '#components/__tests__/render';
import { describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

/** Where a menu opened below `element` goes, in the window's whole pixels. */
function below(element: Element) {
  const { bottom, left } = element.getBoundingClientRect();
  return { left: Math.round(left), top: Math.round(bottom) };
}

// The menus themselves are native, so the end-to-end tests cover what they hold and do.
describe('right-click menu', () => {
  test('opens at the pointer for a photo, and selects it', async () => {
    const { api, screen } = await renderApp();
    const option = screen.getByRole('option', { name: 'portrait.jpg' });
    await option.click({ button: 'right' });
    await expect.poll(() => api.showEntryMenu.mock.calls).toEqual([['portrait.jpg', undefined]]);
    await expect.element(option).toHaveAttribute('aria-selected', 'true');
  });

  test('opens from the keyboard for the selection, below it', async () => {
    const { api, screen } = await renderApp();
    const option = screen.getByRole('option', { name: 'portrait.jpg' });
    await option.click();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await expect
      .poll(() => api.showEntryMenu.mock.calls)
      .toEqual([['portrait.jpg', below(option.element())]]);
  });

  test('scrolls the selection back into view to open it below it', async () => {
    const { api, screen } = await renderApp();
    // A small window and large thumbnails, so the grid scrolls.
    await page.viewport(740, 520);
    await screen.getByRole('slider', { name: 'Thumbnail size' }).fill('200');
    const list = screen.getByRole('listbox', { name: 'Folder contents' });
    const option = list.getByRole('option').first();
    await option.click();
    const grid = list.element();
    grid.scrollTo({ top: grid.scrollHeight });
    const inView = () => {
      const box = option.element().getBoundingClientRect();
      const bounds = grid.getBoundingClientRect();
      return box.top >= bounds.top && box.bottom <= bounds.bottom;
    };
    await expect.poll(inView).toBe(false);
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await expect.poll(() => api.showEntryMenu.mock.calls).toHaveLength(1);
    expect(inView()).toBe(true);
    expect(api.showEntryMenu.mock.calls[0]?.[1]).toEqual(below(option.element()));
  });

  test('opens from the keyboard in the sidebar, below the folder', async () => {
    const { api, screen } = await renderApp();
    const tree = screen.getByRole('tree', { name: 'Folders' });
    await expect.element(tree).toBeVisible();
    tree.element().focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await expect
      .poll(() => api.showEntryMenu.mock.calls)
      .toEqual([['.', { left: expect.any(Number), top: expect.any(Number) }]]);
  });
});

/** The grid, with each photo's menu choosing Rename…. */
async function renderRenaming() {
  const api = fakeFolder(PHOTOS);
  api.showEntryMenu.mockResolvedValue('rename');
  const app = await renderApp({ api });
  await app.screen.getByRole('option', { name: 'landscape.jpg' }).click({ button: 'right' });
  const dialog = app.screen.getByRole('dialog', { name: 'Rename “landscape.jpg”' });
  await expect.element(dialog).toBeVisible();
  return { ...app, dialog };
}

describe('renaming', () => {
  test('the new name shows at once, and the old one again if it is taken, saying why', async () => {
    const { api, dialog, screen } = await renderRenaming();
    const answered = Promise.withResolvers<null>();
    api.renameEntry.mockImplementation(async () => {
      await answered.promise;
      return { error: 'The name “sunset.jpg” is already taken.' };
    });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('sunset.jpg');
    await dialog.getByRole('button', { name: 'Rename' }).click();
    // Shown under its new name while the worker renames it, in its place.
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(screen.getByRole('option', { name: 'sunset.jpg' })).toBeVisible();
    await expect
      .element(screen.getByRole('option', { name: 'landscape.jpg' }))
      .not.toBeInTheDocument();
    expect(api.renameEntry.mock.calls).toEqual([['landscape.jpg', 'sunset.jpg']]);
    answered.resolve(null);
    await expect.element(screen.getByRole('option', { name: 'landscape.jpg' })).toBeVisible();
    const again = screen.getByRole('dialog', { name: 'Rename “landscape.jpg”' });
    await expect
      .element(again.getByRole('alert'))
      .toHaveTextContent('The name “sunset.jpg” is already taken.');
    // What was typed, to change; the field's name now says why too.
    await expect.element(again.getByRole('textbox')).toHaveValue('sunset.jpg');
    await userEvent.keyboard('{Escape}');
    await expect.element(again).not.toBeInTheDocument();
  });

  test('a renamed photo keeps its place under its new name, found by it from then on', async () => {
    const { api, dialog, screen } = await renderRenaming();
    api.renameEntry.mockResolvedValue({
      changes: [],
      entry: { id: 'zebra.jpg', kind: 'image', name: 'zebra.jpg', parentId: '.' },
    });
    const before = screen
      .getByRole('option')
      .elements()
      .map((option) => option.getAttribute('aria-label'));
    await dialog.getByRole('textbox', { name: 'Name' }).fill('zebra.jpg');
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await expect.element(screen.getByRole('option', { name: 'zebra.jpg' })).toBeVisible();
    // Sorted by name it would go last, but it stays where it was until the view's next version.
    expect(
      screen
        .getByRole('option')
        .elements()
        .map((option) => option.getAttribute('aria-label')),
    ).toEqual(before.map((name) => (name === 'landscape.jpg' ? 'zebra.jpg' : name)));
  });

  test('Escape closes the dialog as soon as it opens, renaming nothing', async () => {
    const { api, dialog } = await renderRenaming();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    expect(api.renameEntry).not.toHaveBeenCalled();
  });
});
