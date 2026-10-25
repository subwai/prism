import {
  type Command,
  type Context,
  createKeymap,
  eventChord,
  type Keymap,
  resolveKey
} from '@prism/keybindings';
import type { KeybindingsState } from '@prism/shared';

export interface KeymapSnapshot {
  keymap: Keymap;
  /** Why `keybindings.json` could not be read at all; its last readable rules still apply. */
  fileError: string | null;
}

let snapshot: KeymapSnapshot | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function update(state: KeybindingsState) {
  snapshot = {
    fileError: state.error,
    keymap: createKeymap(globalThis.app.platform, state.defaults, state.user)
  };
  for (const listener of listeners) {
    listener();
  }
}

/** Reads the keymap once, and follows edits to `keybindings.json` from then on. */
export function loadKeymap() {
  loading ??= (async () => {
    globalThis.app.keybindings.onChange(update);
    update(await globalThis.app.keybindings.get());
  })();
  return loading;
}

export function subscribeKeymap(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The keymap, which the root route loads before anything renders. */
export function getKeymap(): KeymapSnapshot {
  if (!snapshot) {
    throw new Error('The keymap has not loaded yet');
  }
  return snapshot;
}

// Contexts the window as a whole is in, such as showing a video, held by what puts it there.
const held = new Map<string, number>();

/** Puts the window in context `name` until the returned function is called. */
export function holdContext(name: string) {
  held.set(name, (held.get(name) ?? 0) + 1);
  return () => {
    held.set(name, (held.get(name) ?? 1) - 1);
  };
}

/**
 * The contexts a key pressed on `target` meets: the window's, plus those of each element
 * around it that names some in `data-keys`, such as `viewerFocus`.
 */
export function contextFor(target: EventTarget | null): Context {
  const context: Context = {
    fullScreen: document.fullscreenElement !== null,
    ...Object.fromEntries([...held].map(([name, count]) => [name, count > 0]))
  };
  const element = target instanceof Element ? target : null;
  for (let node = element?.closest<HTMLElement>('[data-keys]'); node;) {
    for (const name of node.dataset.keys?.split(/\s+/u) ?? []) {
      context[name] = true;
    }
    node = node.parentElement?.closest<HTMLElement>('[data-keys]');
  }
  context.previewFocus = element?.closest('dialog[open]') !== null && element !== null;
  context.textInputFocus = Boolean(
    element?.closest('input:not([type="range"]), select, textarea, [contenteditable]')
  );
  return context;
}

/** The command a key press runs where it happens, if any. */
export function commandFor(event: KeyboardEvent): Command | null {
  return resolveKey(getKeymap().keymap, eventChord(event), contextFor(event.target));
}
