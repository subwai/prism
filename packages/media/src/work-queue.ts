import pLimit from 'p-limit';

/** Bounds native work, and shares a job among everyone asking for the same key meanwhile. */
export class WorkQueue<Value> {
  private readonly jobs = new Map<string, Promise<Value>>();
  private readonly limit;

  constructor(
    concurrency: number,
    private readonly capacity: number,
    private readonly signal: AbortSignal,
  ) {
    this.limit = pLimit(concurrency);
  }

  /** Whether any work is queued or under way. */
  get busy(): boolean {
    return this.jobs.size > 0;
  }

  run(key: string, work: (signal: AbortSignal) => Promise<Value>): Promise<Value> {
    this.signal.throwIfAborted();
    let job = this.jobs.get(key);
    if (!job) {
      if (this.jobs.size >= this.capacity) {
        throw new Error('Work queue is full; retry when visible requests finish.');
      }
      job = this.limit(() => work(this.signal)).finally(() => this.jobs.delete(key));
      this.jobs.set(key, job);
    }
    return job;
  }
}
