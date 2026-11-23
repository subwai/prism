/**
 * Runs tasks one after another: each starts once every task before it has settled, whether it
 * worked or not, so a later task never races an earlier one.
 */
export class OneAfterAnother {
  /** The last task given, settled either way. It never fails, so the next task always runs. */
  #last: Promise<unknown> = Promise.resolve();

  /** Runs `task` after the tasks before it, and settles as it does. */
  run<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.#last.then(() => task());
    this.#last = result.catch(() => null);
    return result;
  }

  /** Settles once every task given so far has. */
  done(): Promise<unknown> {
    return this.#last;
  }
}
