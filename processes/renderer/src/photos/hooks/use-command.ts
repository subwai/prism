import { commandFor } from '#photos/data/keymap';
import { type Command, COMMANDS } from '@prism/keybindings';
import { useEffect, useEffectEvent } from 'react';

const commands = new EventTarget();

/** Runs `command` for whatever handles it, as its key or menu item would. */
export function runCommand(command: Command) {
  commands.dispatchEvent(new Event(command));
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

/** Runs `handler` when `command` is issued, by its key or from the application menu. */
export function useCommand(command: Command, handler: () => void) {
  const run = useEffectEvent(handler);
  useEffect(() => {
    const listener = () => run();
    commands.addEventListener(command, listener);
    return () => commands.removeEventListener(command, listener);
  }, [command]);
}
