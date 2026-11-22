import type { WalkProgress } from '@prism/shared';

/** The walks of folders under way, and how far each has got, which the status bar shows. */
export function walksUnderWay() {
  const walks = new Set<WalkProgress>();
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    /** Hears as a walk starts, looks at a folder, or ends. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Notes a walk that starts, which reads every folder in full if `full`, as `walk`; `progress`
     * notes how many folders it has looked at, of how many it has found, and `end` that it is over.
     */
    start(full: boolean) {
      const walk: WalkProgress = { found: 0, fullRead: full, looked: 0 };
      walks.add(walk);
      tell();
      return {
        end() {
          walks.delete(walk);
          tell();
        },
        progress(looked: number, found: number) {
          walk.looked = looked;
          walk.found = found;
          tell();
        },
        walk,
      };
    },
    walking: (): WalkProgress[] => [...walks],
  };
}

export type Walks = ReturnType<typeof walksUnderWay>;
