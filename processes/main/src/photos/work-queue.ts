interface Waiter<Value> {
  resolve: (value: Value) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
}

interface Job<Value> {
  key: string;
  controller: AbortController;
  work: (signal: AbortSignal) => Promise<Value>;
  waiters: Set<Waiter<Value>>;
  running: boolean;
}

/** Bounds native work and coalesces consumers without sharing their cancellation. */
export class WorkQueue<Value> {
  private readonly jobs = new Map<string, Job<Value>>();
  private active = 0;

  constructor(
    private readonly concurrency: number,
    private readonly capacity: number
  ) {}

  run(key: string, signal: AbortSignal, work: Job<Value>['work']): Promise<Value> {
    signal.throwIfAborted();
    let job = this.jobs.get(key);
    if (!job) {
      if (this.jobs.size >= this.capacity) {
        throw new Error('Work queue is full; retry when visible requests finish.');
      }
      job = { controller: new AbortController(), key, running: false, waiters: new Set(), work };
      this.jobs.set(key, job);
    }
    const target = job;
    const result = new Promise<Value>((resolve, reject) => {
      const waiter: Waiter<Value> = {
        // eslint-disable-next-line no-use-before-define -- The listener and its cleanup refer to each other.
        cleanup: () => signal.removeEventListener('abort', cancel),
        reject,
        resolve
      };
      const cancel = (): void => {
        target.waiters.delete(waiter);
        waiter.cleanup();
        if (!target.running && target.waiters.size === 0) {
          this.jobs.delete(target.key);
          target.controller.abort();
        }
        reject(new Error('Request cancelled.'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      target.waiters.add(waiter);
    });
    this.pump();
    return result;
  }

  private pump(): void {
    for (const job of this.jobs.values()) {
      if (this.active >= this.concurrency) {
        break;
      }
      if (!job.running) {
        job.running = true;
        this.active += 1;
        this.execute(job);
      }
    }
  }

  private async execute(job: Job<Value>): Promise<void> {
    try {
      const value = await job.work(job.controller.signal);
      for (const waiter of job.waiters) {
        waiter.cleanup();
        waiter.resolve(value);
      }
    } catch (error) {
      for (const waiter of job.waiters) {
        waiter.cleanup();
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.jobs.delete(job.key);
      this.active -= 1;
      this.pump();
    }
  }
}
