/**
 * Keyboard shortcuts as VS Code writes them: rules binding a key to a command, optionally only
 * `when` a condition holds. The defaults come first and a user's `keybindings.json` after; for
 * any key press, the last rule that matches wins.
 */

import { type Chord, parseKey, sameChord } from '#keys';
import { type Condition, type Context, parseWhen } from '#when';

/** Every command a key can run, with what it does, for the settings file's notes. */
export const COMMANDS = {
  actualSize: 'Switch the photo between fit and actual size',
  back: 'Go back',
  contextMenu: 'Open the right-click menu of the selected photo, video or folder',
  find: 'Search the current folder',
  forward: 'Go forward',
  fullScreen: 'Show the photo, video or reader full screen, or leave full screen',
  hardReload: 'Reload the window, ignoring its cache',
  mute: 'Mute or unmute the video',
  next: 'Show the next photo or video',
  openFolder: 'Open another folder',
  playPause: 'Play or pause the video',
  preview: 'Open or close the preview of the selected item',
  previous: 'Show the previous photo or video',
  refresh: 'Read the current folder again',
  rename: 'Rename the selected photo, video or folder',
  seekBackward: 'Skip the video back 5 seconds',
  seekForward: 'Skip the video forward 5 seconds',
  slideshow: 'Start or stop the slideshow',
  toggleView: 'Switch to the next view: the grid, the filmstrip or the reader',
  up: 'Go to the enclosing folder',
} as const;

export type Command = keyof typeof COMMANDS;

/** What `when` can test. Focus contexts hold while focus is inside that part of the window. */
export const CONTEXTS = {
  fullScreen: 'Something is shown full screen',
  listFocus: 'Focus is in the grid or filmstrip',
  previewFocus: 'Focus is in a preview sheet',
  textInputFocus: 'Focus is in a text field',
  treeFocus: 'Focus is in the folder sidebar',
  videoShown: 'The viewer shows a video',
  viewerFocus: 'Focus is in the photo viewer or the reader',
  viewerShown: 'A photo viewer is showing',
  watching: 'The video shown has been played, paused, clicked, seeked or scrubbed',
} as const;

/** A rule as written in `keybindings.json`. A command starting with `-` removes rules. */
export interface Keybinding {
  key: string;
  command: string;
  when?: string;
}

interface Rule {
  binding: Keybinding & { command: Command };
  chord: Chord;
  when: Condition;
}

export interface Keymap {
  rules: Rule[];
  /** Rules that could not be used, described for the person who wrote them. */
  errors: string[];
}

function isCommand(name: string): name is Command {
  return Object.hasOwn(COMMANDS, name);
}

/** Rule `index` (counting from 1) of `source`, checked, or a description of what is wrong. */
function check(binding: unknown, index: number): Keybinding | string {
  const where = `Rule ${index + 1}`;
  if (typeof binding !== 'object' || binding === null) {
    return `${where} is not an object`;
  }
  const { key, command, when } = binding as Record<string, unknown>;
  if (typeof command !== 'string' || !isCommand(command.replace(/^-/u, ''))) {
    return `${where}: unknown command ${JSON.stringify(command)}`;
  }
  // Only a removal may leave out the key, to remove every rule for its command.
  const keyless = key === undefined && command.startsWith('-');
  if (!keyless && (typeof key !== 'string' || !parseKey(key))) {
    return `${where}: ${JSON.stringify(key)} is not a key`;
  }
  if (when !== undefined) {
    if (typeof when !== 'string') {
      return `${where}: "when" must be text`;
    }
    try {
      parseWhen(when);
    } catch (error) {
      return `${where}: "when" ${(error as Error).message}`;
    }
  }
  return {
    command,
    key: typeof key === 'string' ? key : '',
    ...(when === undefined ? {} : { when }),
  };
}

/** The rules `list` holds, for `platform` if they are the defaults, which are written for macOS. */
function rulesIn(list: unknown, platform: string, defaults: boolean) {
  if (!Array.isArray(list)) {
    return {
      bindings: [],
      errors: [`${defaults ? 'The defaults' : 'The file'} must hold a list of rules, in [ and ]`],
    };
  }
  const bindings: Keybinding[] = [];
  const errors: string[] = [];
  for (const [index, entry] of (list as unknown[]).entries()) {
    const binding = check(entry, index);
    if (typeof binding === 'string') {
      errors.push(
        defaults ? `Default ${binding.charAt(0).toLowerCase()}${binding.slice(1)}` : binding,
      );
    } else {
      bindings.push(
        defaults && platform !== 'darwin'
          ? { ...binding, key: binding.key.replace(/\bcmd\+/u, 'ctrl+') }
          : binding,
      );
    }
  }
  return { bindings, errors };
}

/**
 * `defaults`, the parsed `default-keybindings.jsonc`, followed by `user`, the parsed
 * `keybindings.json`, on `platform`. Rules that cannot be used are left out and described in
 * `errors`; the rest still apply.
 */
export function createKeymap(platform: string, defaults: unknown, user: unknown = []): Keymap {
  const base = rulesIn(defaults, platform, true);
  const own = rulesIn(user, platform, false);
  let rules: Rule[] = [];
  for (const binding of [...base.bindings, ...own.bindings]) {
    if (binding.command.startsWith('-')) {
      // Removes earlier rules for the command, narrowed by the key and condition if given.
      const command = binding.command.slice(1);
      const chord = binding.key ? parseKey(binding.key) : null;
      rules = rules.filter(
        (rule) =>
          rule.binding.command !== command ||
          (chord !== null && !sameChord(rule.chord, chord)) ||
          (binding.when !== undefined && rule.binding.when !== binding.when),
      );
    } else {
      rules.push(compile(binding));
    }
  }
  return { errors: [...base.errors, ...own.errors], rules };
}

function compile(binding: Keybinding): Rule {
  const chord = parseKey(binding.key);
  if (!chord || !isCommand(binding.command)) {
    throw new Error(`Not a usable rule: ${JSON.stringify(binding)}`);
  }
  const when = binding.when ? parseWhen(binding.when) : () => true;
  return { binding: { ...binding, command: binding.command }, chord, when };
}

/** The command `chord` runs in `context`: the last rule for it that holds. */
export function resolveKey(keymap: Keymap, chord: Chord, context: Context): Command | null {
  for (let index = keymap.rules.length - 1; index >= 0; index -= 1) {
    const rule = keymap.rules[index];
    if (rule && sameChord(rule.chord, chord) && rule.when(context)) {
      return rule.binding.command;
    }
  }
  return null;
}

/** The key shown for `command` in menus and tooltips: its last rule's. */
export function keyFor(keymap: Keymap, command: Command): Chord | null {
  return keymap.rules.findLast((rule) => rule.binding.command === command)?.chord ?? null;
}
