import { holdContext } from '#photos/data/keymap';
import { useEffect } from 'react';

/** Puts the window in context `name`, for the keymap's `when`, while `on`. */
export function useContextKey(name: string, on: boolean) {
  useEffect(() => (on ? holdContext(name) : undefined), [name, on]);
}
