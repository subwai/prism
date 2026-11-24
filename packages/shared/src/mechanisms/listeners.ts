/** A set of functions to call with each new value, such as the subscribers to an event. */
export class Listeners<Value = void> {
  readonly #listeners = new Set<(value: Value) => void>();

  /** How many listeners there are, so a source can stop sending once no one listens. */
  get size(): number {
    return this.#listeners.size;
  }

  /** Adds `listener`, and returns a function that removes it. */
  add(listener: (value: Value) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Tells every listener of `value`. */
  tell(value: Value): void {
    for (const listener of this.#listeners) {
      listener(value);
    }
  }
}
