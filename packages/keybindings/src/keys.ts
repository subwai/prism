/** Keys as rules write them (`cmd+shift+f`), as key presses arrive, and as people read them. */

export interface Chord {
  key: string;
  alt: boolean;
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
}

const MODIFIERS: Record<string, 'alt' | 'cmd' | 'ctrl' | 'shift'> = {
  alt: 'alt',
  cmd: 'cmd',
  ctrl: 'ctrl',
  meta: 'cmd',
  option: 'alt',
  shift: 'shift'
};
const NAMED_KEYS = new Set([
  'backspace',
  'contextmenu',
  'delete',
  'down',
  'end',
  'enter',
  'escape',
  'home',
  'left',
  'pagedown',
  'pageup',
  'right',
  'space',
  'tab',
  'up'
]);

function isKeyName(key: string) {
  return NAMED_KEYS.has(key) || /^(?:[a-z0-9[\];',./\\`=-]|f(?:[1-9]|1[0-2]))$/u.test(key);
}

/** Reads a key such as `cmd+shift+f`, or returns `null` if it names no key. */
export function parseKey(text: string): Chord | null {
  const parts = text.trim().toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const chord: Chord = { alt: false, cmd: false, ctrl: false, key, shift: false };
  for (const part of parts) {
    const modifier = MODIFIERS[part];
    if (!modifier || chord[modifier]) {
      return null;
    }
    chord[modifier] = true;
  }
  return isKeyName(key) ? chord : null;
}

// Keys read by position, as VS Code does, so Shift or Option cannot change what they are.
const CODES: Record<string, string> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/'
};
const EVENT_KEYS: Record<string, string> = {
  ' ': 'space',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up'
};

/** The chord a `KeyboardEvent` presses. */
export function eventChord(event: {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): Chord {
  const letter = /^(?:Key|Digit)(?<char>.)$/u.exec(event.code)?.groups?.char;
  return {
    alt: event.altKey,
    cmd: event.metaKey,
    ctrl: event.ctrlKey,
    key:
      letter?.toLowerCase() ??
      CODES[event.code] ??
      EVENT_KEYS[event.key] ??
      event.key.toLowerCase(),
    shift: event.shiftKey
  };
}

export function sameChord(first: Chord, second: Chord) {
  return (
    first.key === second.key &&
    first.alt === second.alt &&
    first.cmd === second.cmd &&
    first.ctrl === second.ctrl &&
    first.shift === second.shift
  );
}

const ACCELERATOR_KEYS: Record<string, string> = {
  pagedown: 'PageDown',
  pageup: 'PageUp'
};

/** A key's name in Electron accelerator syntax: `Space`, `Left`, `F`. */
function keyName(key: string) {
  return ACCELERATOR_KEYS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** `chord` in Electron accelerator syntax, such as `Cmd+Shift+F`. */
export function toAccelerator(chord: Chord) {
  const modifiers = [
    chord.cmd && 'Cmd',
    chord.ctrl && 'Ctrl',
    chord.alt && 'Alt',
    chord.shift && 'Shift'
  ];
  return [...modifiers.filter(Boolean), keyName(chord.key)].join('+');
}

// Keys as `KeyboardEvent.key` names them, where that differs from the rule's name.
const ARIA_KEYS: Record<string, string> = {
  contextmenu: 'ContextMenu',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  right: 'ArrowRight',
  up: 'ArrowUp'
};

/** `chord` as `aria-keyshortcuts` writes it, such as `Meta+Shift+F`, for screen readers. */
export function toAriaKeyShortcut(chord: Chord) {
  const modifiers = [
    chord.alt && 'Alt',
    chord.ctrl && 'Control',
    chord.cmd && 'Meta',
    chord.shift && 'Shift'
  ];
  const key = ARIA_KEYS[chord.key] ?? keyName(chord.key);
  return [...modifiers.filter(Boolean), key].join('+');
}

const MAC_SYMBOLS = { alt: '⌥', cmd: '⌘', ctrl: '⌃', shift: '⇧' };
const KEY_SYMBOLS: Record<string, string> = { down: '↓', left: '←', right: '→', up: '↑' };

/** How `chord` is written on `platform`: `⇧⌘S` on macOS, `Ctrl+Shift+S` elsewhere. */
export function formatChord(chord: Chord, platform: string) {
  const key = KEY_SYMBOLS[chord.key] ?? keyName(chord.key);
  if (platform === 'darwin') {
    const order = ['ctrl', 'alt', 'shift', 'cmd'] as const;
    return [
      ...order.filter((modifier) => chord[modifier]).map((modifier) => MAC_SYMBOLS[modifier]),
      key
    ].join('');
  }
  const names = [
    chord.cmd && 'Meta',
    chord.ctrl && 'Ctrl',
    chord.alt && 'Alt',
    chord.shift && 'Shift'
  ];
  return [...names.filter(Boolean), key].join('+');
}
