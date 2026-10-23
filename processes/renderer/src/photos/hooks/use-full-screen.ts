import { useCallback, useRef, useSyncExternalStore } from 'react';

function subscribe(notify: () => void) {
  document.addEventListener('fullscreenchange', notify);
  return () => document.removeEventListener('fullscreenchange', notify);
}

/** Puts the element `ref` is attached to on its own across the screen, and brings it back. */
export function useFullScreen() {
  const element = useRef<HTMLElement>(null);
  const isFullScreen = () =>
    element.current !== null && document.fullscreenElement === element.current;
  const fullScreen = useSyncExternalStore(subscribe, isFullScreen);
  const ref = useCallback((node: HTMLElement) => {
    element.current = node;
    // Escape leaves full screen, as in a browser, and does nothing else: a sheet the element
    // sits in stays open.
    function leaveOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && document.fullscreenElement === node) {
        event.preventDefault();
        document.exitFullscreen().catch(() => null);
      }
    }
    // Keys go where focus is, so it moves into the element from whatever the element now
    // covers, and goes back on leaving, which can also drop it to the page itself.
    let shown = false;
    let returnTo: Element | null = null;
    function moveFocus() {
      const was = shown;
      shown = document.fullscreenElement === node;
      if (shown && !was) {
        returnTo = document.activeElement;
        if (!node.contains(returnTo)) {
          node.focus({ preventScroll: true });
        }
      } else if (was && !shown) {
        const focused = document.activeElement;
        const lost = focused === null || focused === document.body;
        if (returnTo instanceof HTMLElement && returnTo.isConnected && !node.contains(returnTo)) {
          if (lost || node.contains(focused)) {
            returnTo.focus({ preventScroll: true });
          }
        } else if (lost) {
          node.focus({ preventScroll: true });
        }
      }
    }
    globalThis.addEventListener('keydown', leaveOnEscape);
    document.addEventListener('fullscreenchange', moveFocus);
    return () => {
      element.current = null;
      globalThis.removeEventListener('keydown', leaveOnEscape);
      document.removeEventListener('fullscreenchange', moveFocus);
    };
  }, []);
  function toggle() {
    // Read afresh: the document changes before `fullscreenchange` brings a render. Either
    // call rejects when the window cannot change, which leaves it as it was.
    if (isFullScreen()) {
      document.exitFullscreen().catch(() => null);
    } else {
      element.current?.requestFullscreen().catch(() => null);
    }
  }
  return { fullScreen, ref, toggle };
}
