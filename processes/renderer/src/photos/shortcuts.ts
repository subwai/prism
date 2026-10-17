import { formatShortcut, type ShortcutName } from '@app/shared';

/** How a shortcut is written on this platform, for tooltips and hints. */
export function shortcutLabel(name: ShortcutName) {
  return formatShortcut(name, globalThis.app.platform);
}

/**
 * Shift plus `key` (a letter, `' '`, or a name such as `'ArrowLeft'`) and no other modifier,
 * outside fields that take typing, where Shift and a letter type a capital.
 */
export function isShiftKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>,
  key: string
) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return (
    event.key.toUpperCase() === key.toUpperCase() &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !target?.closest('input:not([type="range"]), textarea, [contenteditable]')
  );
}
