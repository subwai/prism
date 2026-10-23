import { keybindingsTemplate, readKeybindings } from '@app/keybindings';
import DEFAULTS from '@app/keybindings/default-keybindings.jsonc?raw';
import { KEYBINDING_CHANNELS, type KeybindingsState } from '@app/shared';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { watch } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'keybindings.json',
  DEFAULTS_NAME = 'default-keybindings.jsonc',
  // Editors often save in several steps; this waits for the last.
  SETTLE_MS = 100;

function keybindingsFile() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

// The app's own rules, which ship inside it; checked by tests, so they always read.
const defaults = readKeybindings(DEFAULTS).rules;

async function readFileText(file: string) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

/** Opens `file` in the system's editor for it, or shows it to open some other way. */
async function open(file: string) {
  if ((await shell.openPath(file)) !== '') {
    shell.showItemInFolder(file);
  }
}

/** Creates `keybindings.json` if need be, then opens it in the system's editor for it. */
export async function openKeybindings() {
  const file = keybindingsFile();
  await writeFile(file, keybindingsTemplate(), { flag: 'wx' }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  );
  await open(file);
}

/**
 * Opens the defaults, as VS Code shows its own: a read-only copy, written afresh each time
 * so it matches the app, next to the user's file.
 */
export async function openDefaultKeybindings() {
  const file = path.join(app.getPath('userData'), DEFAULTS_NAME);
  await rm(file, { force: true });
  await writeFile(file, DEFAULTS, { mode: 0o444 });
  await open(file);
}

/**
 * Reads `keybindings.json` and keeps reading it as it changes, calling `onChange` with each
 * version, and resolves once the first is read. While the file does not parse, its last
 * readable rules stay in use.
 */
export function startKeybindings(onChange: (state: KeybindingsState) => void) {
  let state: KeybindingsState = { defaults, error: null, user: [] };
  async function load() {
    let next: { error: string | null; rules: unknown };
    try {
      next = readKeybindings(await readFileText(keybindingsFile()));
    } catch (error) {
      next = { error: (error as Error).message, rules: [] };
    }
    state = { defaults, error: next.error, user: next.error === null ? next.rules : state.user };
    onChange(state);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(KEYBINDING_CHANNELS.changed, state);
    }
  }
  const ready = load();
  let timer: NodeJS.Timeout | undefined;
  // The folder rather than the file, which may not exist yet and which editors may replace.
  watch(app.getPath('userData'), (_event, filename) => {
    if (filename === FILE_NAME) {
      clearTimeout(timer);
      timer = setTimeout(load, SETTLE_MS);
    }
  });
  ipcMain.handle(KEYBINDING_CHANNELS.get, async () => {
    await ready;
    return state;
  });
  ipcMain.handle(KEYBINDING_CHANNELS.open, openKeybindings);
  return ready;
}
