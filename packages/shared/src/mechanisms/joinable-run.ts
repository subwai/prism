/**
 * A piece of work that callers join while it is under way: asking for it starts it, or, if it
 * is already running, waits for that run instead of starting a second one. Once it settles, the
 * next ask starts it again. Some call this "single flight".
 */
export class JoinableRun<Result> {
  #running: Promise<Result> | undefined;

  constructor(private readonly work: () => Promise<Result>) {}

  /** Starts the work, or joins the run under way. */
  run(): Promise<Result> {
    this.#running ??= this.work().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  /** The run under way, if there is one, without starting one. */
  get underWay(): Promise<Result> | undefined {
    return this.#running;
  }
}
