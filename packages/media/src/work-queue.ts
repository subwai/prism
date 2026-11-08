import pLimit from 'p-limit';

/** Bounds native work, and shares a job among everyone asking for the same key meanwhile. */
export interface WorkQueue<Value> {
  /** Whether any work is queued or under way. */
  readonly busy: boolean;
  run: (key: string, work: (signal: AbortSignal) => Promise<Value>) => Promise<Value>;
}

export function createWorkQueue<Value>(
  concurrency: number,
  capacity: number,
  signal: AbortSignal,
): WorkQueue<Value> {
  const jobs = new Map<string, Promise<Value>>();
  const limit = pLimit(concurrency);
  return {
    get busy() {
      return jobs.size > 0;
    },
    run(key, work) {
      signal.throwIfAborted();
      let job = jobs.get(key);
      if (!job) {
        if (jobs.size >= capacity) {
          throw new Error('Work queue is full; retry when visible requests finish.');
        }
        job = limit(() => work(signal)).finally(() => jobs.delete(key));
        jobs.set(key, job);
      }
      return job;
    },
  };
}
