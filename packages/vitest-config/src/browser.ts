/** A step of `commands.mouse`, to a point in CSS pixels from the test page's top left corner. */
export type MouseStep =
  | { move: { left: number; top: number }; steps?: number }
  | { down: true }
  | { up: true };

/** The media features `commands.emulateMedia` sets; `null` goes back to the system's own. */
export interface EmulatedMedia {
  contrast?: 'more' | 'no-preference' | null;
  forcedColors?: 'active' | 'none' | null;
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    /**
     * Has the page match media features as a system setting would, such as Increase Contrast,
     * until set back with `null`.
     */
    emulateMedia: (media: EmulatedMedia) => Promise<void>;
    /**
     * Moves, presses and releases the real mouse, which `userEvent` only does as part of a
     * whole click, hover or drag and drop: for dragging a slider's thumb or panning a photo
     * by steps, holding still partway.
     */
    mouse: (steps: MouseStep[]) => Promise<void>;
  }
}
