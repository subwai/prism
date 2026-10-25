import { getKeymap, subscribeKeymap } from '#keyboard/keymap';
import type { Shortcut } from '@prism/design-system';
import { type Command, formatChord, keyFor, toAriaKeyShortcut } from '@prism/keybindings';
import { useSyncExternalStore } from 'react';

/** The keymap as it stands, following edits to `keybindings.json`. */
export function useKeymap() {
  return useSyncExternalStore(subscribeKeymap, getKeymap);
}

/** Each command's key, for the controls that run it: their tooltips and screen readers. */
export function useShortcut() {
  const { keymap } = useKeymap();
  return (command: Command): Shortcut | undefined => {
    const chord = keyFor(keymap, command);
    return chord
      ? { keys: toAriaKeyShortcut(chord), label: formatChord(chord, globalThis.app.platform) }
      : undefined;
  };
}

/** How each command's key is written on this platform, for hints in text. */
export function useShortcutLabel() {
  const shortcut = useShortcut();
  return (command: Command) => shortcut(command)?.label;
}
