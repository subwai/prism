import type { Page } from 'playwright-core';

/**
 * The accessible name of what fills the screen, or `null` if nothing does, or `'moving'` while
 * it is still moving there or back. Tests wait for the move to end because a view transition
 * takes the pointer while it runs, so a click would miss. The transition counts as running
 * from the moment it starts: that is when the element is marked full screen, though its
 * animations start only a few frames later.
 */
export function fullScreenElement(page: Page) {
  return page.evaluate(() => {
    const moving =
      (document as Document & { activeViewTransition?: unknown }).activeViewTransition ||
      document
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
            '::view-transition',
          ),
        );
    return moving
      ? 'moving'
      : (document.querySelector('[data-full-screen]')?.getAttribute('aria-label') ?? null);
  });
}
