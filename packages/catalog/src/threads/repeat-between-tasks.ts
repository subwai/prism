/**
 * Runs a step again and again, each time after the work already waiting on this thread, such as
 * calls that came in meanwhile, so that work goes in between rather than waiting for every step.
 * It stops once the step returns `false`. Starting again drops the run under way.
 */
export class RepeatBetweenTasks {
  #next: ReturnType<typeof setImmediate> | undefined;

  constructor(private readonly step: () => boolean) {}

  /** Runs the step next, after the work already waiting, and on until it is done. */
  start(): void {
    this.stop();
    this.#next = setImmediate(() => {
      if (this.step()) {
        this.start();
      }
    });
  }

  stop(): void {
    clearImmediate(this.#next);
    this.#next = undefined;
  }
}
