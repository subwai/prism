import { renderApp, sendUpdateNotice, skippableTimers } from '#components/__tests__/render';
import { describe, expect, test, vi } from 'vitest';

// Checking is the main process's, behind the menu's Check for Updates; these cover what the
// window shows of what a check found.
describe('checking for updates', () => {
  test('what a check found shows for a few seconds, then goes', async () => {
    skippableTimers();
    const { screen } = await renderApp();
    await expect.element(screen.getByRole('option', { name: 'landscape.jpg' })).toBeVisible();
    sendUpdateNotice({
      message: 'You’re up to date: Prism 1.4.0 is the newest version.',
      warning: false,
    });
    const notice = screen.getByText(/^You’re up to date/u);
    await expect.element(notice).toBeVisible();
    await vi.advanceTimersByTimeAsync(5000);
    await expect.element(notice).not.toBeInTheDocument();
  });

  test('a check that failed is a warning', async () => {
    const { screen } = await renderApp();
    await expect.element(screen.getByRole('option', { name: 'landscape.jpg' })).toBeVisible();
    sendUpdateNotice({ message: 'Couldn’t check for updates: offline', warning: true });
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Couldn’t check for updates: offline');
  });
});
