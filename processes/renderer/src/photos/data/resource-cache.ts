import type { RequestQueue } from '#photos/data/request-queue';

interface Entry<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: unknown) => void;
  /** Queued work that nobody wanted by its turn stops here until it is read again. */
  parked: boolean;
  settled: { value: Value } | null;
}

/**
 * One request per key, shared by every reader until `clear`, so components can pass the
 * promise to `use()` during render. Loaders should resolve with a value describing failures.
 */
export class ResourceCache<Value> {
  private readonly entries = new Map<string, Entry<Value>>();

  constructor(
    private readonly queue: RequestQueue,
    private readonly limit: number,
    private readonly onSettle?: () => void
  ) {}

  /** `wanted` is checked when the request reaches the front of the queue. */
  read(key: string, load: () => Promise<Value>, wanted: () => boolean = () => true) {
    let entry = this.entries.get(key);
    if (entry?.settled) {
      // Recently read results are the last to be trimmed.
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.promise;
    }
    if (!entry) {
      entry = { ...Promise.withResolvers<Value>(), parked: true, settled: null };
      this.entries.set(key, entry);
    }
    if (entry.parked) {
      entry.parked = false;
      this.start(entry, load, wanted);
    }
    return entry.promise;
  }

  peek(key: string) {
    return this.entries.get(key)?.settled ?? null;
  }

  /** Whether `key` has been read, even if its request is still on its way. */
  has(key: string) {
    return this.entries.has(key);
  }

  /** Swaps a settled value for a newer one, such as a listing updated in place. */
  replace(key: string, value: Value) {
    if (this.entries.get(key)?.settled) {
      const settled = Promise.withResolvers<Value>();
      Object.assign(settled.promise, { status: 'fulfilled', value });
      settled.resolve(value);
      this.entries.set(key, { ...settled, parked: false, settled: { value } });
    }
  }

  /** Forgets `key`, so the next read loads it again; returns its value if it had one. */
  evict(key: string) {
    const settled = this.entries.get(key)?.settled;
    this.entries.delete(key);
    return settled ?? null;
  }

  /** Empties the cache, returning the values it held. */
  clear() {
    const values = new Map<string, Value>();
    for (const [key, entry] of this.entries) {
      if (entry.settled) {
        values.set(key, entry.settled.value);
      }
    }
    this.entries.clear();
    return values;
  }

  private start(entry: Entry<Value>, load: () => Promise<Value>, wanted: () => boolean) {
    this.queue
      .run(async () => {
        if (!wanted()) {
          entry.parked = true;
          return;
        }
        const value = await load();
        entry.settled = { value };
        // React's thenable protocol: `use()` reads a settled promise without suspending.
        Object.assign(entry.promise, { status: 'fulfilled', value });
        entry.resolve(value);
        this.trim();
        this.onSettle?.();
      })
      .catch((error: unknown) => {
        Object.assign(entry.promise, { reason: error, status: 'rejected' });
        entry.reject(error);
      });
  }

  private trim() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) {
        return;
      }
      if (entry.settled) {
        this.entries.delete(key);
      }
    }
  }
}
