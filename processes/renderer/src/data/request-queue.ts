interface Job {
  key: string;
  start: () => Promise<unknown>;
}

/**
 * Limits IPC pressure, including work waiting for the utility process. Work for an entry
 * nobody `wanted` by its turn, such as a thumbnail scrolled past, waits aside until `wake`
 * says it is wanted again, so work for what is on screen is never stuck behind it.
 */
export class RequestQueue {
  private active = 0;
  private readonly waiting: Job[] = [];
  private readonly parked = new Map<string, Job[]>();

  constructor(
    private readonly concurrency: number,
    private readonly wanted: (key: string) => boolean = () => true,
  ) {}

  run<Value>(key: string, work: () => Promise<Value>): Promise<Value> {
    const result = Promise.withResolvers<Value>();
    this.waiting.push({ key, start: () => work().then(result.resolve, result.reject) });
    this.pump();
    return result.promise;
  }

  /** Puts the work parked for `key` back in line. */
  wake(key: string) {
    const jobs = this.parked.get(key);
    if (jobs) {
      this.parked.delete(key);
      this.waiting.push(...jobs);
      this.pump();
    }
  }

  private pump() {
    while (this.active < this.concurrency) {
      const job = this.waiting.shift();
      if (!job) {
        return;
      }
      if (this.wanted(job.key)) {
        this.active += 1;
        job.start().finally(() => {
          this.active -= 1;
          this.pump();
        });
      } else {
        this.parked.set(job.key, [...(this.parked.get(job.key) ?? []), job]);
      }
    }
  }
}
