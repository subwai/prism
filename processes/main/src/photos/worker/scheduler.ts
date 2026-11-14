import { DroppedError } from '#photos/worker/dropped-error';
import {
  CAPACITY,
  type Lane,
  PRIORITIES,
  type Priority,
  startable,
} from '#photos/worker/scheduling';

/** Says how much a job matters now, `null` once nothing wants it. */
export type Want = () => Priority | null;

/** Wanted as what the window waits for, such as a folder it lists or a photo the viewer opens. */
export const VISIBLE: Want = () => 'visible';

interface Job {
  lane: Lane;
  key: string;
  /** Everyone who asked for it, of whom the one who wants it most decides its priority. */
  wants: Want[];
  work: (signal: AbortSignal) => Promise<unknown>;
  result: PromiseWithResolvers<unknown>;
}

function priorityOf(job: Job): Priority | null {
  let best: Priority | null = null;
  for (const want of job.wants) {
    const priority = want();
    if (
      priority !== null &&
      (best === null || PRIORITIES.indexOf(priority) < PRIORITIES.indexOf(best))
    ) {
      best = priority;
    }
  }
  return best;
}

function weigh(job: Job) {
  return { lane: job.lane, priority: priorityOf(job) };
}

/**
 * The one place a folder's worker orders its disk work: thumbnails, conversions, folders' reads,
 * tiles and photos' details. Each job says how much it is wanted each time the scheduler looks,
 * so work follows what the window shows as it changes; see `scheduling.ts` for the order and the
 * limits. Jobs of a lane share their key, as two asking for one thumbnail share its making.
 */
export class Scheduler {
  #waiting: Job[] = [];
  readonly #running = new Set<Job>();
  #pumping = false;

  constructor(private readonly signal: AbortSignal) {}

  /**
   * Runs `work` once the scheduler gives it its turn, or joins the job of `lane` under `key` that
   * waits or runs already. It is dropped, rejecting with `DroppedError`, if before its turn no one
   * who asked for it `wants` it any more. Rejects at once if the lane is full, or the worker is
   * closing.
   */
  run<Value>(
    lane: Lane,
    key: string,
    wants: Want,
    work: (signal: AbortSignal) => Promise<Value>,
  ): Promise<Value> {
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason);
    }
    const joined = this.#find(lane, key);
    if (joined) {
      joined.wants.push(wants);
      this.reconsider();
      return joined.result.promise as Promise<Value>;
    }
    const waiting = this.#waiting.filter((job) => job.lane === lane).length;
    if (waiting >= (CAPACITY[lane] ?? Infinity)) {
      return Promise.reject(new Error('Work queue is full; retry when visible requests finish.'));
    }
    const job: Job = { key, lane, result: Promise.withResolvers(), wants: [wants], work };
    this.#waiting.push(job);
    this.reconsider();
    return job.result.promise as Promise<Value>;
  }

  /** Adds `wants` to the job of `lane` under `key`, if one waits or runs; says whether one did. */
  raise(lane: Lane, key: string, wants: Want): boolean {
    const job = this.#find(lane, key);
    job?.wants.push(wants);
    this.reconsider();
    return job !== undefined;
  }

  /**
   * Looks again at what is wanted, as when the window shows something else: drops waiting work
   * nothing wants any more, and starts what may start. Called on every change it hears of, and
   * batched to one look a task.
   */
  reconsider(): void {
    if (this.#pumping) {
      return;
    }
    this.#pumping = true;
    queueMicrotask(() => {
      this.#pumping = false;
      this.#pump();
    });
  }

  #find(lane: Lane, key: string) {
    const matches = (job: Job) => job.lane === lane && job.key === key;
    return (
      this.#waiting.find((job) => matches(job)) ?? [...this.#running].find((job) => matches(job))
    );
  }

  #pump() {
    if (this.signal.aborted) {
      this.#rejectAll(this.signal.reason);
      return;
    }
    this.#dropUnwanted();
    this.#startWhatMay();
  }

  #rejectAll(reason: unknown) {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const job of waiting) {
      job.result.reject(reason);
    }
  }

  /** Lets go of the waiting jobs nothing wants any more. */
  #dropUnwanted() {
    const unwanted = this.#waiting.filter((job) => priorityOf(job) === null);
    this.#waiting = this.#waiting.filter((job) => !unwanted.includes(job));
    for (const job of unwanted) {
      job.result.reject(new DroppedError());
    }
  }

  /** Starts the waiting jobs the policy lets start; see `startable`. */
  #startWhatMay() {
    const waiting = this.#waiting;
    const running = [...this.#running];
    const starting = startable(
      waiting.map((job) => weigh(job)),
      running.map((job) => weigh(job)),
    ).map((index) => waiting[index] as Job);
    // Taken out of line first, as work that starts may ask for more.
    this.#waiting = waiting.filter((job) => !starting.includes(job));
    for (const job of starting) {
      this.#start(job);
    }
  }

  #start(job: Job) {
    this.#running.add(job);
    Promise.resolve()
      .then(() => job.work(this.signal))
      .then(job.result.resolve, job.result.reject)
      .finally(() => {
        this.#running.delete(job);
        this.reconsider();
      });
  }
}
