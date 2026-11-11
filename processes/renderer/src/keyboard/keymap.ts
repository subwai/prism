import {
  type Command,
  type Context,
  createKeymap,
  eventChord,
  type Keymap,
  resolveKey,
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
    keymap: createKeymap(globalThis.app.platform, state.defaults, state.user),
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

/**
 * Where keys and commands go: the open modal sheet, frontmost, or else the window. Everything
 * outside a modal sheet is inert, so it neither has focus nor hears commands.
 */
export function frontLayer(): ParentNode {
  return [...document.querySelectorAll('dialog:modal')].at(-1) ?? document;
}

/** Whether `element` belongs to `layer` itself, rather than to a sheet open inside it. */
export function inLayer(element: Element, layer: ParentNode) {
  return (element.closest('dialog:modal') ?? document) === layer;
}

function names(element: Element, attribute: 'keys' | 'layerKeys') {
  return element instanceof HTMLElement ? (element.dataset[attribute]?.split(/\s+/u) ?? []) : [];
}

/**
 * The contexts a key pressed on `target` meets: those each element around it names in
 * `data-keys`, such as `viewerFocus`, and those any element in the frontmost layer names in
 * `data-layer-keys`, such as `videoShown`, wherever focus is.
 */
function contextFor(target: EventTarget | null): Context {
  const context: Context = { fullScreen: document.querySelector('[data-full-screen]') !== null };
  const element = target instanceof Element ? target : null;
  for (let node = element?.closest('[data-keys]'); node;) {
    for (const name of names(node, 'keys')) {
      context[name] = true;
    }
    node = node.parentElement?.closest('[data-keys]');
  }
  const layer = frontLayer();
  for (const node of layer.querySelectorAll('[data-layer-keys]')) {
    if (inLayer(node, layer)) {
      for (const name of names(node, 'layerKeys')) {
        context[name] = true;
      }
    }
  }
  context.previewFocus = element?.closest('dialog[open]') !== null && element !== null;
  context.textInputFocus = Boolean(
    element?.closest('input:not([type="range"]), select, textarea, [contenteditable]'),
  );
  return context;
}

/** The command a key press runs where it happens, if any. */
export function commandFor(event: KeyboardEvent): Command | null {
  return resolveKey(getKeymap().keymap, eventChord(event), contextFor(event.target));
}
