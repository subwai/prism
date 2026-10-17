import type { PhotosAPI } from '#photos';

/** Actions the application menu (and its keyboard shortcuts) asks the window to perform. */
export type AppCommand =
  | 'back'
  | 'find'
  | 'forward'
  | 'mute'
  | 'open-folder'
  | 'play-pause'
  | 'refresh'
  | 'seek-backward'
  | 'seek-forward'
  | 'slideshow'
  | 'toggle-view'
  | 'up';

export interface AppAPI {
  /** Subscribes to menu commands; returns the unsubscribe function. */
  onCommand: (listener: (command: AppCommand) => void) => () => void;
  ping: () => Promise<string>;
  /** `process.platform`, so the renderer can show the right shortcuts. */
  platform: string;
  photos: PhotosAPI;
}
