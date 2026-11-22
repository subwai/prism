export const APP_NAME = 'Prism';
/** The channel on which the main process sends the window menu and keyboard commands. */
export const COMMAND_CHANNEL = 'app:command';
/**
 * The command-line argument that tells the window which logs the `DEBUG` environment variable
 * turns on, as in `--prism-debug=prism:*`. The window cannot read environment variables itself.
 */
export const DEBUG_ARGUMENT = '--prism-debug=';
/** Passed to the window when the app runs unpackaged, as in development and in the tests. */
export const DEVELOPMENT_ARGUMENT = '--prism-development';

export const APPEARANCE_CHANNELS = {
  accentColor: 'appearance:accent-color',
  accentColorChanged: 'appearance:accent-color-changed',
} as const;

export const FULL_SCREEN_CHANNELS = {
  changed: 'full-screen:changed',
  set: 'full-screen:set',
} as const;

export const KEYBINDING_CHANNELS = {
  changed: 'keybindings:changed',
  get: 'keybindings:get',
  open: 'keybindings:open',
} as const;

export const UPDATE_CHANNELS = {
  install: 'updates:install',
  isReady: 'updates:is-ready',
  notice: 'updates:notice',
  ready: 'updates:ready',
} as const;
