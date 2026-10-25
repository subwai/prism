import { useCallback } from 'react';

/** How long the pointer rests before the controls, and the pointer itself, hide. */
const IDLE_MS = 2000;

/** How far the pointer can seem to move, from rounding alone, while it rests. */
const STILL_PX = 3;

/**
 * While `enabled`, marks the element the returned ref goes on `data-idle` once the pointer has
 * rested over it a while, and clears that as soon as the pointer moves or presses, or focus
 * moves inside. Styles hide the floating controls and the pointer under it, as a video player
 * does in full screen. A pointer resting on a toolbar keeps it all showing.
 */
export function useIdlePointer(enabled: boolean) {
  return useCallback(
    (node: HTMLElement) => {
      if (!enabled) {
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let last: { screenX: number; screenY: number } | null = null;
      function rest() {
        // Checked again later rather than left to the next move, since a toolbar can go from
        // under a resting pointer, as a video's does when a slideshow moves on.
        if (node.querySelector('[role="group"]:hover')) {
          timer = setTimeout(rest, IDLE_MS);
          return;
        }
        node.toggleAttribute('data-idle', true);
        // A tooltip sits in the top layer, out of reach of the controls fading out.
        for (const hint of node.querySelectorAll<HTMLElement>(':popover-open')) {
          hint.hidePopover();
        }
      }
      function wake() {
        node.toggleAttribute('data-idle', false);
        clearTimeout(timer);
        timer = setTimeout(rest, IDLE_MS);
      }
      // Chromium can send a move with the pointer still, as when what is under it changes,
      // which a slideshow does all the time, and after scrolling, as the reader's slideshow
      // does, at a position rounded differently from the last real one. Only a move of a few
      // pixels from where the pointer last woke the controls counts.
      function onMove(event: PointerEvent) {
        if (
          !last ||
          Math.hypot(event.screenX - last.screenX, event.screenY - last.screenY) > STILL_PX
        ) {
          last = { screenX: event.screenX, screenY: event.screenY };
          wake();
        }
      }
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerdown', wake);
      node.addEventListener('focusin', wake);
      wake();
      return () => {
        clearTimeout(timer);
        node.toggleAttribute('data-idle', false);
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerdown', wake);
        node.removeEventListener('focusin', wake);
      };
    },
    [enabled],
  );
}
