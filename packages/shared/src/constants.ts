export const APP_NAME = 'Prism',
  PING_CHANNEL = 'app:ping',
  COMMAND_CHANNEL = 'app:command';

export const KEYBINDING_CHANNELS = {
  changed: 'keybindings:changed',
  get: 'keybindings:get',
  open: 'keybindings:open'
} as const;
