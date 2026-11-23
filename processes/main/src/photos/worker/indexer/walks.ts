import type { WalkProgress } from '@prism/shared';

/** Keeps track of the folder walks under way and how far each has got, for the status bar. */
export function trackWalks() {
  const walks = new Set<WalkProgress>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    list: (): WalkProgress[] => [...walks],
    /** Calls `listener` whenever a walk starts, looks at a folder, or ends. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Notes that a walk starts, reading every folder in full if `fullRead`. Returns the walk's
     * progress as `walk`, with `progress` to note how many folders it has looked at of how many
     * it has found so far, and `end` to note that it is over.
     */
    start(fullRead: boolean) {
      const walk: WalkProgress = { found: 0, fullRead, looked: 0 };
      walks.add(walk);
      notify();
      return {
        end() {
          walks.delete(walk);
          notify();
        },
        progress(looked: number, found: number) {
          walk.looked = looked;
          walk.found = found;
          notify();
        },
        walk,
      };
    },
  };
}

export type Walks = ReturnType<typeof trackWalks>;
