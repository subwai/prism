import { formatShortcut, type ShortcutName } from '@app/shared';

/** How a shortcut is written on this platform, for tooltips and hints. */
export function shortcutLabel(name: ShortcutName) {
  return formatShortcut(name, globalThis.app.platform);
}

/** Shift plus `letter` and no other modifier, outside text fields, where it types a capital. */
export function isShiftKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>,
  letter: string
) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return (
    event.key.toUpperCase() === letter &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !target?.closest('input, textarea, [contenteditable]')
  );
}
