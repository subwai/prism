import { getKeymap, subscribeKeymap } from '#photos/data/keymap';
import { type Command, formatChord, keyFor } from '@app/keybindings';
import { useSyncExternalStore } from 'react';

/** The keymap as it stands, following edits to `keybindings.json`. */
export function useKeymap() {
  return useSyncExternalStore(subscribeKeymap, getKeymap);
}

/** How each command's key is written on this platform, for tooltips and hints. */
export function useShortcutLabel() {
  const { keymap } = useKeymap();
  return (command: Command) => {
    const chord = keyFor(keymap, command);
    return chord ? formatChord(chord, globalThis.app.platform) : undefined;
  };
}
