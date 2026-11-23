/** What `runAFewAtATime` runs. */
interface FewAtATime<Item> {
  /** How many run at once, at most. */
  limit: number;
  /** The next item to start, or `null` if there is none to start now. */
  takeNext: () => Item | null;
  /** Runs one item. */
  run: (item: Item) => Promise<void>;
}

/**
 * Runs the items `takeNext` hands out, at most `limit` at once, starting the next as soon as one
 * finishes. It settles once `takeNext` has nothing to start and nothing is running. `takeNext`
 * is asked again each time one finishes, so a list that grows while this runs, such as the
 * folders a walk finds, is taken up as it grows, and a caller stops early by returning `null`.
 *
 * `p-limit` also runs a few at a time, but takes every item up front. A walk can find a hundred
 * thousand folders, and holding a waiting call for each would take a hundred megabytes.
 */
export async function runAFewAtATime<Item>({ limit, takeNext, run }: FewAtATime<Item>) {
  const running = new Set<Promise<void>>();
  for (;;) {
    while (running.size < limit) {
      const item = takeNext();
      if (item === null) {
        break;
      }
      const job = run(item).finally(() => running.delete(job));
      running.add(job);
    }
    if (running.size === 0) {
      return;
    }
    await Promise.race(running);
  }
}
