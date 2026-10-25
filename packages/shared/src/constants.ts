export const APP_NAME = 'Prism',
  COMMAND_CHANNEL = 'app:command',
  /** Passed to the renderer when the app runs unpackaged, as in development and the tests. */
  DEVELOPMENT_ARGUMENT = '--prism-development';

export const APPEARANCE_CHANNELS = {
  accentColor: 'appearance:accent-color',
  accentColorChanged: 'appearance:accent-color-changed'
} as const;

export const KEYBINDING_CHANNELS = {
  changed: 'keybindings:changed',
  get: 'keybindings:get',
  open: 'keybindings:open'
} as const;
