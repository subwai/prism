/** What a `OneAtATimeQueue` does, and in what order. */
interface QueueWork<Key, Result> {
  /** Does the work for one key. */
  work: (key: Key) => Promise<Result>;
  /** The waiting key to work on next, of those `isWaiting` says wait; `null` if none. */
  pickNext: (isWaiting: (key: Key) => boolean) => Key | null;
  /** Hears `true` as the queue starts working, and `false` once nothing is left to do. */
  busy: (busy: boolean) => void;
}

/**
 * Keys waiting for work, done one at a time. A key waits once, however often it is asked for,
 * and everyone who asked hears the one result. `pickNext` chooses which waiting key goes next,
 * such as the one used most recently. A key asked for again while its work is under way waits
 * again, for work that starts after.
 */
export class OneAtATimeQueue<Key, Result> {
  /** The keys waiting, with what waits for each. */
  readonly #waiting = new Map<Key, PromiseWithResolvers<Result>>();
  #current: Key | undefined;
  readonly #isWaiting = (key: Key) => this.#waiting.has(key);

  constructor(private readonly queue: QueueWork<Key, Result>) {}

  /** The work for `key`, once the keys picked before it are done. */
  want(key: Key): Promise<Result> {
    let waiter = this.#waiting.get(key);
    if (!waiter) {
      waiter = Promise.withResolvers();
      this.#waiting.set(key, waiter);
      this.#workThrough();
    }
    return waiter.promise;
  }

  /** Takes `key` out of line, if it waits, and answers those waiting for it with `answer`. */
  drop(key: Key, answer: Result): void {
    this.#waiting.get(key)?.resolve(answer);
    this.#waiting.delete(key);
  }

  /** Whether `key` waits, or is being worked on. */
  isAsked(key: Key): boolean {
    return key === this.#current || this.#waiting.has(key);
  }

  /** Works through the waiting keys, one at a time, unless that is under way. */
  async #workThrough() {
    if (this.#current !== undefined) {
      return;
    }
    let next = this.#takeNext();
    if (next) {
      this.queue.busy(true);
    }
    while (next) {
      const [key, waiter] = next;
      this.#current = key;
      try {
        waiter.resolve(await this.queue.work(key));
      } catch (error) {
        waiter.reject(error);
      } finally {
        this.#current = undefined;
      }
      next = this.#takeNext();
      if (!next) {
        this.queue.busy(false);
      }
    }
  }

  /** Takes the key `pickNext` chooses out of line, with what waits for it. */
  #takeNext() {
    const key = this.queue.pickNext(this.#isWaiting);
    const waiter = key === null ? undefined : this.#waiting.get(key);
    if (key === null || !waiter) {
      return null;
    }
    this.#waiting.delete(key);
    return [key, waiter] as const;
  }
}
