export const APP_NAME = 'Prism';
export const COMMAND_CHANNEL = 'app:command';
/** Passes the window the logs `DEBUG` turns on, as `--prism-debug=prism:*`. */
export const DEBUG_ARGUMENT = '--prism-debug=';
/** Passed to the renderer when the app runs unpackaged, as in development and the tests. */
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
