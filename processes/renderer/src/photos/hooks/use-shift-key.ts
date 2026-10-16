import { isShiftKey } from '#photos/shortcuts';
import { useEffect, useEffectEvent } from 'react';

/**
 * Runs `handler` for Shift plus `letter` anywhere in the window, unless something focused
 * already handled it. Such keys cannot be menu accelerators without breaking typing.
 */
export function useShiftKey(letter: string, handler: () => void) {
  const run = useEffectEvent(handler);
  useEffect(() => {
    function listener(event: KeyboardEvent) {
      if (!event.defaultPrevented && isShiftKey(event, letter)) {
        event.preventDefault();
        run();
      }
    }
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, [letter]);
}
