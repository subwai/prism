interface Job {
  key: string;
  start: () => Promise<unknown>;
}

/**
 * Limits IPC pressure, including work waiting for the utility process. Work for an entry
 * nobody `wanted` by its turn, such as a thumbnail scrolled past, waits aside until `wake`
 * says it is wanted again, so work for what is on screen is never stuck behind it.
 */
export interface RequestQueue {
  run: <Value>(key: string, work: () => Promise<Value>) => Promise<Value>;
  /** Puts the work parked for `key` back in line. */
  wake: (key: string) => void;
}

export function createRequestQueue(
  concurrency: number,
  wanted: (key: string) => boolean = () => true,
): RequestQueue {
  const waiting: Job[] = [];
  const parked = new Map<string, Job[]>();
  const state = { active: 0 };

  function pump() {
    while (state.active < concurrency) {
      const job = waiting.shift();
      if (!job) {
        return;
      }
      if (wanted(job.key)) {
        state.active += 1;
        job.start().finally(() => {
          state.active -= 1;
          pump();
        });
      } else {
        parked.set(job.key, [...(parked.get(job.key) ?? []), job]);
      }
    }
  }

  return {
    run<Value>(key: string, work: () => Promise<Value>) {
      const result = Promise.withResolvers<Value>();
      waiting.push({ key, start: () => work().then(result.resolve, result.reject) });
      pump();
      return result.promise;
    },
    wake(key) {
      const jobs = parked.get(key);
      if (jobs) {
        parked.delete(key);
        waiting.push(...jobs);
        pump();
      }
    },
  };
}
