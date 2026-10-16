import type { AppCommand } from '@app/shared';
import { useEffect, useEffectEvent } from 'react';

/** Runs `handler` when the application menu, or its keyboard shortcut, issues `command`. */
export function useCommand(command: AppCommand, handler: () => void) {
  const run = useEffectEvent(handler);
  useEffect(
    () =>
      globalThis.app.onCommand((issued) => {
        if (issued === command) {
          run();
        }
      }),
    [command]
  );
}
