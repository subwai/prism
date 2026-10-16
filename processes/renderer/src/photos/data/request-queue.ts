/** Limits IPC pressure, including work waiting for the utility process. */
export class RequestQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  run<Value>(work: () => Promise<Value>, signal?: AbortSignal): Promise<Value> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        // The abort listener and queued callback share one lifetime.
        // oxlint-disable-next-line no-use-before-define
        const index = this.waiting.indexOf(start);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        reject(signal?.reason);
      };
      const start = () => {
        this.active += 1;
        work()
          .then(resolve, reject)
          .finally(() => {
            signal?.removeEventListener('abort', abort);
            this.active -= 1;
            this.waiting.shift()?.();
          });
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (this.active < this.concurrency) {
        start();
      } else {
        this.waiting.push(start);
      }
    });
  }
}
