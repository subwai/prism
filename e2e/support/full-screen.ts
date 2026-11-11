import type { Page } from 'playwright-core';

/**
 * The accessible name of what fills the screen, if anything does, once it has finished moving
 * there or back: while it moves, a view transition takes the pointer, which would miss it. The
 * transition is under way from when it starts, which marks the element full screen as it updates
 * the page, though its animations start only a few frames later.
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
