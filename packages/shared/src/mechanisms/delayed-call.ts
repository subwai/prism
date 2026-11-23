/**
 * Calls `run` once, `delayMs` after the first request, however many requests come in between.
 * A burst of changes is then sent as one message rather than one each, at most once every
 * `delayMs`. Some call this a "throttle".
 */
export class DelayedCall {
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly run: () => void,
    private readonly delayMs: number,
  ) {}

  /** Asks for the call. Asks made before it happens join it. */
  request(): void {
    this.#timer ??= setTimeout(() => {
      this.#timer = undefined;
      this.run();
    }, this.delayMs);
  }

  /** Drops the call asked for, if it has not happened yet. */
  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
