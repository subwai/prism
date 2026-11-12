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

/** What a check for updates the user asked for found, for the window to show briefly. */
export interface UpdateNotice {
  message: string;
  /** Whether the check failed, rather than finding an update or none. */
  warning: boolean;
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
  fullScreen: {
    /**
     * Takes the window full screen, in a Space of its own on macOS, or out of it. Resolves once
     * its transition has finished, to whether this changed it: `false` when it already was.
     */
    set: (fullScreen: boolean) => Promise<boolean>;
    /**
     * Subscribes to the window leaving full screen another way, as from its green button;
     * returns the unsubscribe function.
     */
    onChange: (listener: (fullScreen: boolean) => void) => () => void;
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
  updates: {
    /** Subscribes to what checks for updates find; returns the unsubscribe function. */
    onNotice: (listener: (notice: UpdateNotice) => void) => () => void;
  };
  /** The logs `DEBUG` turns on, which the window logs too; see `debug`. */
  debug: string;
  /** Whether the app runs unpackaged, which opens up tools such as the design system catalog. */
  development: boolean;
  /** `process.platform`, so the renderer can show the right shortcuts. */
  platform: string;
  photos: PhotosAPI;
}
