export const APP_NAME = 'Prism',
  COMMAND_CHANNEL = 'app:command',
  /** Passes the window the logs `DEBUG` turns on, as `--prism-debug=prism:*`. */
  DEBUG_ARGUMENT = '--prism-debug=',
  /** Passed to the renderer when the app runs unpackaged, as in development and the tests. */
  DEVELOPMENT_ARGUMENT = '--prism-development';

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
