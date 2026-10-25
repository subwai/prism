import { commandFor, frontLayer, inLayer } from '#keyboard/keymap';
import { type Command, COMMANDS } from '@prism/keybindings';
import { type RefCallback, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

type Handlers = Partial<Record<Command, () => void>>;

/** A command on its way to whatever handles it, bubbling up from where it starts. */
class CommandEvent extends Event {
  constructor(readonly command: Command) {
    super('command', { bubbles: true, cancelable: true });
  }
}

/** Sends `command` from `target`; true if something handled it. */
function send(target: EventTarget, command: Command) {
  const event = new CommandEvent(command);
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Runs `command` as its key or menu item would, like a responder chain: first what has focus
 * and what holds it, up to the window; then, if none of those handles it, the fallbacks of the
 * frontmost layer, the open sheet or else the window, innermost first. So the viewer's keys
 * work with focus elsewhere in its sheet, and a covered viewer never hears them.
 */
export function runCommand(command: Command) {
  if (send(document.activeElement ?? document.body, command)) {
    return;
  }
  const layer = frontLayer();
  const fallbacks = [...layer.querySelectorAll('[data-command-fallback]')].filter((element) =>
    inLayer(element, layer),
  );
  for (const fallback of fallbacks.toReversed()) {
    if (send(fallback, command)) {
      return;
    }
  }
}

// Keys that something focused already handled are left alone, as is the reload the menu
// does itself.
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) {
    return;
  }
  const command = commandFor(event);
  if (command && command !== 'hardReload') {
    event.preventDefault();
    runCommand(command);
  }
}

/** Carries out commands from the menu and from keys, as the keymap resolves them. */
export function startCommands() {
  globalThis.addEventListener('keydown', onKey);
  const stopMenu = globalThis.app.onCommand((command) => {
    if (Object.hasOwn(COMMANDS, command)) {
      runCommand(command);
    }
  });
  return () => {
    globalThis.removeEventListener('keydown', onKey);
    stopMenu();
  };
}

/** Runs the handler `handlers` has for a command that reaches it, and stops it there. */
function handle(event: Event, handlers: Handlers) {
  const handler = event instanceof CommandEvent ? handlers[event.command] : undefined;
  if (handler) {
    event.preventDefault();
    event.stopPropagation();
    handler();
  }
}

/** The handlers of the latest render, for listeners that outlive it. */
function useLatest(handlers: Handlers) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  return latest;
}

/**
 * Handles `handlers`' commands while focus is inside the element the returned ref goes on.
 * As a `fallback`, it also handles those nothing focused does while it is in the frontmost
 * layer: how the viewer answers its keys with focus on the sheet's close button.
 */
export function useCommands(
  handlers: Handlers,
  { fallback = false } = {},
): RefCallback<HTMLElement> {
  const latest = useLatest(handlers);
  return useCallback(
    (element: HTMLElement) => {
      element.toggleAttribute('data-command-fallback', fallback);
      const listener = (event: Event) => handle(event, latest.current);
      element.addEventListener('command', listener);
      return () => element.removeEventListener('command', listener);
    },
    [fallback, latest],
  );
}

/** Handles `handlers`' commands wherever focus is, when nothing closer to it does. */
export function useGlobalCommands(handlers: Handlers) {
  const latest = useLatest(handlers);
  useEffect(() => {
    const listener = (event: Event) => handle(event, latest.current);
    document.addEventListener('command', listener);
    return () => document.removeEventListener('command', listener);
  }, [latest]);
}
