interface Job {
  key: string;
  start: () => Promise<unknown>;
}

/**
 * Runs a few jobs at a time, to limit how much is waiting on other processes at once.
 * - A job whose key is no longer wanted when its turn comes, such as a photo scrolled past, is
 *   parked until `wake` says it is wanted again. Work for what is on screen is never stuck
 *   behind it.
 * - A job whose `signal` aborts before it starts is dropped. TanStack Query aborts a query that
 *   nothing shows any more, so what scrolled away for good does not wait forever.
 */
export class RequestQueue {
  private active = 0;
  private waiting: Job[] = [];
  private readonly parked = new Map<string, Job[]>();

  constructor(
    private readonly concurrency: number,
    private readonly isWanted: (key: string) => boolean = () => true,
  ) {}

  run<Value>(key: string, work: () => Promise<Value>, signal?: AbortSignal): Promise<Value> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    const result = Promise.withResolvers<Value>();
    // Stops listening for the abort once the work starts, after which it runs its course.
    const started = new AbortController();
    const job: Job = {
      key,
      start: () => {
        started.abort();
        return work().then(result.resolve, result.reject);
      },
    };
    signal?.addEventListener(
      'abort',
      () => {
        this.remove(job);
        result.reject(signal.reason);
      },
      { once: true, signal: started.signal },
    );
    this.waiting.push(job);
    this.startJobs();
    return result.promise;
  }

  /** Puts the work parked for `key` back in line. */
  wake(key: string) {
    const jobs = this.parked.get(key);
    if (jobs) {
      this.parked.delete(key);
      this.waiting.push(...jobs);
      this.startJobs();
    }
  }

  /** Takes `job` out of line, or from where it is parked, before it starts. */
  private remove(job: Job) {
    this.waiting = this.waiting.filter((waiting) => waiting !== job);
    const parked = this.parked.get(job.key)?.filter((other) => other !== job) ?? [];
    if (parked.length > 0) {
      this.parked.set(job.key, parked);
    } else {
      this.parked.delete(job.key);
    }
  }

  private startJobs() {
    while (this.active < this.concurrency) {
      const job = this.waiting.shift();
      if (!job) {
        return;
      }
      if (this.isWanted(job.key)) {
        this.active += 1;
        job.start().finally(() => {
          this.active -= 1;
          this.startJobs();
        });
      } else {
        this.parked.set(job.key, [...(this.parked.get(job.key) ?? []), job]);
      }
    }
  }
}
