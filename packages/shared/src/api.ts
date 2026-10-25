import type { PhotosAPI } from '#photos';
import type { Command } from '@prism/keybindings';

/** The keyboard shortcuts: the app's defaults, and the user's from `keybindings.json`. */
export interface KeybindingsState {
  /** The rules in `default-keybindings.jsonc`, which ships with the app. */
  defaults: unknown;
  /** The user file's rules, or the last that could be read while it does not parse. */
  user: unknown;
  /** A problem reading the file as a whole, such as a JSON syntax error. */
  error: string | null;
}

export interface AppAPI {
  appearance: {
    /**
     * The accent colour the user chose for the system, as CSS colour text, or `null` where
     * there is none to follow, so the app keeps its own.
     */
    getAccentColor: () => Promise<string | null>;
    /** Subscribes to changes of the system's accent colour; returns the unsubscribe function. */
    onAccentColorChange: (listener: (color: string | null) => void) => () => void;
  };
  /** Subscribes to menu commands; returns the unsubscribe function. */
  onCommand: (listener: (command: Command) => void) => () => void;
  keybindings: {
    get: () => Promise<KeybindingsState>;
    /** Subscribes to edits of `keybindings.json`; returns the unsubscribe function. */
    onChange: (listener: (state: KeybindingsState) => void) => () => void;
    /** Opens `keybindings.json` in the system's editor, creating it first if need be. */
    open: () => Promise<void>;
  };
  ping: () => Promise<string>;
  /** Whether the app runs unpackaged, which opens up tools such as the design system catalog. */
  development: boolean;
  /** `process.platform`, so the renderer can show the right shortcuts. */
  platform: string;
  photos: PhotosAPI;
}
