import {
  installUpdate,
  sendUpdateNotice,
  sendUpdateReady,
} from '#components/__tests__/fake-updates';
import { renderApp, skippableTimers } from '#components/__tests__/render';
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

// Putting the update off lasts until the next launch, so that test comes last.
describe('a downloaded update', () => {
  test('offers to restart into it, and stays until the user does', async () => {
    skippableTimers();
    const { screen } = await renderApp();
    await expect.element(screen.getByRole('option', { name: 'landscape.jpg' })).toBeVisible();
    sendUpdateReady();
    await expect.element(screen.getByText('An update is ready.')).toBeVisible();
    await vi.advanceTimersByTimeAsync(60_000);
    await screen.getByRole('button', { name: 'Restart' }).click();
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  test('gives way to what a check found for a moment', async () => {
    skippableTimers();
    const { screen } = await renderApp();
    await expect.element(screen.getByRole('option', { name: 'landscape.jpg' })).toBeVisible();
    sendUpdateReady();
    sendUpdateNotice({ message: 'Couldn’t check for updates: offline', warning: true });
    await expect.element(screen.getByText('An update is ready.')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(5000);
    await expect.element(screen.getByText('An update is ready.')).toBeVisible();
  });

  test('can be put off until the next launch', async () => {
    const { screen } = await renderApp();
    await expect.element(screen.getByRole('option', { name: 'landscape.jpg' })).toBeVisible();
    sendUpdateReady();
    await screen.getByRole('button', { name: 'Later' }).click();
    await expect.element(screen.getByText('An update is ready.')).not.toBeInTheDocument();
    sendUpdateReady();
    await expect.element(screen.getByText('An update is ready.')).not.toBeInTheDocument();
  });
});
