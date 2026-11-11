import { renderApp, skippableTimers } from '#components/__tests__/render';
import { SLIDE_MS } from '#components/viewer/use-slideshow-timer';
import { describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

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
