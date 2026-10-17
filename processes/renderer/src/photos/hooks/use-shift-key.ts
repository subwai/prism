import { isShiftKey } from '#photos/shortcuts';
import { useEffect, useEffectEvent } from 'react';

/**
 * Runs `handler` for Shift plus `key` anywhere in the window while `enabled`, unless something
 * focused already handled it. Such keys cannot be menu accelerators without breaking typing.
 */
export function useShiftKey(key: string, handler: () => void, enabled = true) {
  const run = useEffectEvent(handler);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    function listener(event: KeyboardEvent) {
      if (!event.defaultPrevented && isShiftKey(event, key)) {
        event.preventDefault();
        run();
      }
    }
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, [key, enabled]);
}
