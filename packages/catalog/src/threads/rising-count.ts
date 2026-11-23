/** A count that only goes up, and promises that settle once it reaches the number they wait for. */
export class RisingCount {
  #value = 0;
  readonly #waiting = new Set<{ target: number; resolve: () => void }>();

  get value(): number {
    return this.#value;
  }

  /** Raises the count to `to`, if that is higher, and settles the promises it now reaches. */
  raise(to: number): void {
    this.#value = Math.max(this.#value, to);
    for (const waiter of this.#waiting) {
      if (waiter.target <= this.#value) {
        this.#waiting.delete(waiter);
        waiter.resolve();
      }
    }
  }

  /** Settles once the count reaches `target`, at once if it has already. */
  reached(target: number): Promise<void> {
    if (target <= this.#value) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#waiting.add({ resolve, target });
    });
  }
}
