/**
 * Runs tasks one after another for each key, such as each photo: a task waits for the earlier
 * tasks of its key, but not for other keys' tasks. A key is forgotten once its tasks are done,
 * so this holds only the keys with work under way.
 */
export class OneAfterAnotherPerKey<Key> {
  /** The last task given for each key, settled either way. */
  readonly #last = new Map<Key, Promise<unknown>>();

  /** Runs `task` after the tasks before it for `key`, and settles as it does. */
  run<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
    const result = (this.#last.get(key) ?? Promise.resolve()).then(() => task());
    const settled = result.catch(() => null);
    this.#last.set(key, settled);
    settled
      .then(() => {
        if (this.#last.get(key) === settled) {
          this.#last.delete(key);
        }
      })
      .catch(() => null);
    return result;
  }
}
