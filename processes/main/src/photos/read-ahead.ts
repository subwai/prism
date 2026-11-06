/**
 * Reads `source` to the end straight away, keeping what it yields until it is iterated, so
 * several sources can be read at once and still be consumed one after another. An error ends
 * the iteration where it happened; one nobody iterates to is dropped. `p-limit` and the like
 * bound promises, not iterables that stream, so this is our own.
 */
export function readAhead<Item>(source: AsyncIterable<Item>): AsyncIterable<Item> {
  const items: Item[] = [];
  let done = false,
    failure: { error: unknown } | undefined,
    more = Promise.withResolvers<null>();
  // Called after each item and at the end, so one wait always has something new to show.
  const notify = () => {
    more.resolve(null);
    more = Promise.withResolvers();
  };
  const read = async () => {
    try {
      for await (const item of source) {
        items.push(item);
        notify();
      }
    } catch (error) {
      failure = { error };
    } finally {
      done = true;
      notify();
    }
  };
  read().catch(() => null);
  return {
    async *[Symbol.asyncIterator]() {
      for (let index = 0; ; index += 1) {
        if (index === items.length && !done) {
          // oxlint-disable-next-line no-await-in-loop -- Each wait is for the next item.
          await more.promise;
        }
        if (index < items.length) {
          yield items[index] as Item;
        } else if (failure) {
          throw failure.error;
        } else {
          return;
        }
      }
    },
  };
}

/**
 * The items of each of `sources` in turn, with the source they came from, reading up to `ahead`
 * sources at once and at most `limit` in all. Sources may be added to the end while they are
 * iterated. Reads still under way stop, through their signal, when the iteration ends.
 */
export async function* readInOrder<Source, Item>(
  sources: Source[],
  read: (source: Source, signal: AbortSignal) => AsyncIterable<Item>,
  { ahead, limit = Infinity, signal }: { ahead: number; limit?: number; signal: AbortSignal },
): AsyncGenerator<[Source, Item], void> {
  const reads: (AsyncIterable<Item> | undefined)[] = [];
  const controller = new AbortController();
  const reading = AbortSignal.any([signal, controller.signal]);
  const startReads = (current: number) => {
    const end = Math.min(sources.length, current + ahead, limit);
    for (let index = reads.length; index < end; index += 1) {
      reads.push(readAhead(read(sources[index] as Source, reading)));
    }
  };
  try {
    for (const [current, source] of sources.entries()) {
      if (current >= limit) {
        return;
      }
      startReads(current);
      for await (const item of reads[current] ?? []) {
        yield [source, item];
        startReads(current);
      }
      reads[current] = undefined;
    }
  } finally {
    controller.abort();
  }
}
