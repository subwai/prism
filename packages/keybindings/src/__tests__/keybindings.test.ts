import DEFAULT_FILE from '#default-keybindings.jsonc?raw';
import {
  COMMANDS,
  createKeymap,
  eventChord,
  formatChord,
  keyFor,
  parseKey,
  parseWhen,
  readKeybindings,
  resolveKey,
  toAccelerator,
  toAriaKeyShortcut,
} from '#index';
import { describe, expect, it } from 'vitest';

const DEFAULTS = readKeybindings(DEFAULT_FILE).rules;

/** The chord `text` presses, for rules that are known to parse. */
function chord(text: string) {
  const parsed = parseKey(text);
  if (!parsed) {
    throw new Error(`${text} is not a key`);
  }
  return parsed;
}

describe('keys', () => {
  it('reads modifiers in any order and case, under either name', () => {
    expect(parseKey('Shift+Cmd+F')).toEqual(chord('cmd+shift+f'));
    expect(parseKey('option+meta+left')).toEqual(chord('alt+cmd+left'));
    expect(parseKey('ContextMenu')).toEqual(chord('contextmenu'));
  });

  it('rejects what is not a key', () => {
    expect(parseKey('shift+')).toBeNull();
    expect(parseKey('hyper+f')).toBeNull();
    expect(parseKey('shift+shift+f')).toBeNull();
    expect(parseKey('f13')).toBeNull();
  });

  it('reads letters and punctuation by position, whatever Shift or Option type', () => {
    const press = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: true };
    expect(eventChord({ ...press, code: 'KeyM', key: 'Â' })).toEqual(chord('alt+shift+m'));
    expect(eventChord({ ...press, code: 'BracketLeft', key: '”' })).toEqual(chord('alt+shift+['));
    expect(eventChord({ ...press, altKey: false, code: 'Space', key: ' ' })).toEqual(
      chord('shift+space'),
    );
    expect(eventChord({ ...press, altKey: false, code: 'ArrowRight', key: 'ArrowRight' })).toEqual(
      chord('shift+right'),
    );
  });

  it('writes keys for menus, tooltips and screen readers', () => {
    expect(toAccelerator(chord('shift+cmd+f'))).toBe('Cmd+Shift+F');
    expect(toAccelerator(chord('space'))).toBe('Space');
    expect(toAccelerator(chord('ctrl+pageup'))).toBe('Ctrl+PageUp');
    expect(formatChord(chord('cmd+shift+r'), 'darwin')).toBe('⇧⌘R');
    expect(formatChord(chord('ctrl+shift+r'), 'win32')).toBe('Ctrl+Shift+R');
    expect(formatChord(chord('shift+space'), 'darwin')).toBe('⇧Space');
    expect(formatChord(chord('shift+right'), 'linux')).toBe('Shift+→');
    expect(formatChord(chord('m'), 'darwin')).toBe('M');
    expect(toAriaKeyShortcut(chord('cmd+shift+f'))).toBe('Meta+Shift+F');
    expect(toAriaKeyShortcut(chord('ctrl+alt+up'))).toBe('Alt+Control+ArrowUp');
    expect(toAriaKeyShortcut(chord('shift+space'))).toBe('Shift+Space');
    expect(toAriaKeyShortcut(chord('f2'))).toBe('F2');
    expect(toAriaKeyShortcut(chord('contextmenu'))).toBe('ContextMenu');
  });
});

describe('conditions', () => {
  it('combines contexts with !, && and ||, && binding tighter', () => {
    const when = parseWhen('first || second && !third');
    expect(when({ first: true })).toBe(true);
    expect(when({ second: true })).toBe(true);
    expect(when({ second: true, third: true })).toBe(false);
    expect(parseWhen('!(first || second)')({ second: true })).toBe(false);
  });

  it('explains a condition that does not parse', () => {
    expect(() => parseWhen('first &&')).toThrow('unexpected end');
    expect(() => parseWhen('(first')).toThrow('expected ")" at the end');
    expect(() => parseWhen('first second')).toThrow('unexpected "second"');
  });
});

describe('keymap', () => {
  it('uses Ctrl for Cmd outside macOS', () => {
    const keymap = createKeymap('win32', DEFAULTS);
    expect(resolveKey(keymap, chord('ctrl+o'), {})).toBe('openFolder');
    expect(resolveKey(keymap, chord('cmd+o'), {})).toBeNull();
  });

  it('gets around with bare keys, and works a video with Shift', () => {
    const keymap = createKeymap('darwin', DEFAULTS);
    const video = { videoShown: true, viewerFocus: true, watching: true };
    expect(resolveKey(keymap, chord('right'), video)).toBe('next');
    expect(resolveKey(keymap, chord('space'), video)).toBe('preview');
    expect(resolveKey(keymap, chord('shift+right'), video)).toBe('seekForward');
    expect(resolveKey(keymap, chord('shift+space'), video)).toBe('playPause');
    expect(resolveKey(keymap, chord('shift+right'), { viewerFocus: true })).toBeNull();
    expect(resolveKey(keymap, chord('right'), { listFocus: true })).toBeNull();
    expect(resolveKey(keymap, chord('shift+right'), { listFocus: true, videoShown: true })).toBe(
      'seekForward',
    );
  });

  it('previews a folder cover with Shift-Space, unless a video is shown', () => {
    const keymap = createKeymap('darwin', DEFAULTS);
    expect(resolveKey(keymap, chord('shift+space'), { listFocus: true })).toBe('previewCover');
    expect(resolveKey(keymap, chord('shift+space'), { videoShown: true })).toBe('playPause');
    expect(resolveKey(keymap, chord('shift+space'), { textInputFocus: true })).toBeNull();
  });

  it('keeps bare keys out of text fields', () => {
    const keymap = createKeymap('darwin', DEFAULTS);
    expect(resolveKey(keymap, chord('space'), {})).toBe('preview');
    expect(resolveKey(keymap, chord('space'), { textInputFocus: true })).toBeNull();
    expect(resolveKey(keymap, chord('shift+m'), { videoShown: true })).toBe('mute');
    const typing = { textInputFocus: true, videoShown: true };
    expect(resolveKey(keymap, chord('shift+m'), typing)).toBeNull();
  });

  it('lets later rules win, and shows their keys', () => {
    const keymap = createKeymap('darwin', DEFAULTS, [
      { command: 'next', key: 'n', when: 'viewerFocus' },
    ]);
    expect(resolveKey(keymap, chord('n'), { viewerFocus: true })).toBe('next');
    expect(keyFor(keymap, 'next')).toEqual(chord('n'));
    // A rule for a key taken by a default replaces it.
    const taken = createKeymap('darwin', DEFAULTS, [{ command: 'slideshow', key: 'cmd+o' }]);
    expect(resolveKey(taken, chord('cmd+o'), {})).toBe('slideshow');
  });

  it('removes defaults, by command alone or narrowed by key', () => {
    const all = createKeymap('darwin', DEFAULTS, [{ command: '-next' }]);
    expect(keyFor(all, 'next')).toBeNull();
    const one = createKeymap('darwin', DEFAULTS, [{ command: '-contextMenu', key: 'contextmenu' }]);
    expect(resolveKey(one, chord('contextmenu'), { listFocus: true })).toBeNull();
    expect(resolveKey(one, chord('shift+f10'), { listFocus: true })).toBe('contextMenu');
  });

  it('skips rules it cannot use, saying why, and applies the rest', () => {
    const keymap = createKeymap('darwin', DEFAULTS, [
      { command: 'nxt', key: 'n' },
      { command: 'next', key: 'hyper+n' },
      { command: 'next', key: 'n', when: 'viewerFocus &&' },
      'next',
      { command: 'previous', key: 'p' },
    ]);
    expect(keymap.errors).toEqual([
      'Rule 1: unknown command "nxt"',
      'Rule 2: "hyper+n" is not a key',
      'Rule 3: "when" unexpected end',
      'Rule 4 is not an object',
    ]);
    expect(resolveKey(keymap, chord('p'), {})).toBe('previous');
    expect(createKeymap('darwin', DEFAULTS, {}).errors).toHaveLength(1);
  });

  it('reads the defaults that ship with the app without a problem', () => {
    expect(readKeybindings(DEFAULT_FILE).error).toBeNull();
    expect(createKeymap('darwin', DEFAULTS).errors).toEqual([]);
  });

  it('binds a key for every command by default', () => {
    const keymap = createKeymap('linux', DEFAULTS);
    for (const command of Object.keys(COMMANDS) as (keyof typeof COMMANDS)[]) {
      expect(keyFor(keymap, command), command).not.toBeNull();
    }
  });
});
