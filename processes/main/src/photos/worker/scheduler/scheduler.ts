import {
  FOCUSED_LIMITS,
  jobsToStart,
  LIMITS,
  MAX_WAITING,
  PRIORITIES,
  type PrioritizedJob,
  type Priority,
} from '#photos/worker/scheduler/limits';
import { NoLongerWantedError } from '#photos/worker/scheduler/no-longer-wanted-error';
import { JOB_KINDS, type JobCounts, type JobKind, Listeners } from '@prism/shared';

/**
 * Returns how much a job matters right now, or `null` once nothing wants it. The scheduler asks
 * again each time it decides what to start, so a job's priority follows what the window shows.
 */
export type CurrentPriority = () => Priority | null;

/** For work the window waits for, such as a folder it lists or a photo the viewer opens. */
export const ALWAYS_VISIBLE: CurrentPriority = () => 'visible';

interface Job {
  kind: JobKind;
  key: string;
  /** One for each caller who asked for the job. The highest of them is the job's priority. */
  priorities: CurrentPriority[];
  work: (signal: AbortSignal, priority: CurrentPriority) => Promise<unknown>;
  result: PromiseWithResolvers<unknown>;
}

function priorityOf(job: Job): Priority | null {
  let best: Priority | null = null;
  for (const askerPriority of job.priorities) {
    const priority = askerPriority();
    if (
      priority !== null &&
      (best === null || PRIORITIES.indexOf(priority) < PRIORITIES.indexOf(best))
    ) {
      best = priority;
    }
  }
  return best;
}

function count(jobs: Iterable<Job>, kind: JobKind) {
  return [...jobs].filter((job) => job.kind === kind).length;
}

function prioritized(job: Job): PrioritizedJob {
  return { kind: job.kind, priority: priorityOf(job) };
}

/**
 * The one place a library worker orders its disk work: thumbnails, conversions, folder reads,
 * tiles and photos' details. Each job's priority is asked for again every time the scheduler
 * decides what to start, so work follows what the window shows. See `limits.ts` for the order
 * and the limits.
 *
 * Two requests for the same kind and key share one job, so two callers asking for one thumbnail
 * make it once. While the disk is offline nothing starts. A job that `failedOffline` says
 * failed because the disk went offline goes back to waiting, so work waits for the disk to
 * return instead of failing over and over.
 */
export class Scheduler {
  #waiting: Job[] = [];
  readonly #running = new Set<Job>();
  readonly #listeners = new Listeners();
  #isRescheduling = false;
  #focused = false;
  #paused = false;

  constructor(
    private readonly signal: AbortSignal,
    private readonly failedOffline: (error: unknown) => Promise<boolean> = () =>
      Promise.resolve(false),
  ) {}

  /**
   * Runs `work` when the scheduler gives it a turn. If a job of `kind` under `key` is already
   * waiting or running, this joins it instead.
   *
   * - The job is dropped, rejecting with `NoLongerWantedError`, if nobody who asked for it still
   *   wants it when its turn comes.
   * - Rejects at once if too many jobs of `kind` wait already, or the worker is closing.
   * - `work` is given the job's current priority, for work it waits on in turn.
   */
  run<Value>(
    kind: JobKind,
    key: string,
    priority: CurrentPriority,
    work: (signal: AbortSignal, priority: CurrentPriority) => Promise<Value>,
  ): Promise<Value> {
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason);
    }
    const joined = this.#find(kind, key);
    if (joined) {
      joined.priorities.push(priority);
      this.reschedule();
      return joined.result.promise as Promise<Value>;
    }
    const waiting = this.#waiting.filter((job) => job.kind === kind).length;
    if (waiting >= (MAX_WAITING[kind] ?? Infinity)) {
      return Promise.reject(new Error('Work queue is full; retry when visible requests finish.'));
    }
    const job: Job = { key, kind, priorities: [priority], result: Promise.withResolvers(), work };
    this.#waiting.push(job);
    this.reschedule();
    return job.result.promise as Promise<Value>;
  }

  /** How many jobs of each kind are running, and how many are waiting. */
  jobCounts(): Record<JobKind, JobCounts> {
    return Object.fromEntries(
      JOB_KINDS.map((kind) => [
        kind,
        { running: count(this.#running, kind), waiting: count(this.#waiting, kind) },
      ]),
    ) as Record<JobKind, JobCounts>;
  }

  /**
   * Sets whether a Prism window is focused. While one is, more photos' details are read at once
   * in the background (`FOCUSED_LIMITS`). Work already running carries on either way.
   */
  setFocused(focused: boolean): void {
    this.#focused = focused;
    this.reschedule();
  }

  /**
   * Sets whether the disk is offline. While it is, no job starts. Work already running carries
   * on, and waiting jobs keep waiting, or are dropped once nothing wants them.
   */
  setPaused(paused: boolean): void {
    this.#paused = paused;
    this.reschedule();
  }

  /** Calls `listener` whenever jobs may have started, finished or been dropped; see `jobCounts`. */
  onChange(listener: () => void): () => void {
    return this.#listeners.add(listener);
  }

  /**
   * Decides again what to run, as after the window shows something else: drops waiting work
   * that nothing wants any more, and starts what may start. It is called after every change,
   * and the calls within one task are batched into one decision.
   */
  reschedule(): void {
    if (this.#isRescheduling) {
      return;
    }
    this.#isRescheduling = true;
    queueMicrotask(() => {
      this.#isRescheduling = false;
      this.#decide();
    });
  }

  #find(kind: JobKind, key: string) {
    const matches = (job: Job) => job.kind === kind && job.key === key;
    return (
      this.#waiting.find((job) => matches(job)) ?? [...this.#running].find((job) => matches(job))
    );
  }

  #decide() {
    if (this.signal.aborted) {
      this.#rejectAll(this.signal.reason);
      return;
    }
    this.#dropUnwanted();
    this.#startWhatMay();
    this.#listeners.tell();
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
      job.result.reject(new NoLongerWantedError());
    }
  }

  /** Starts the waiting jobs the limits let start; see `jobsToStart`. */
  #startWhatMay() {
    if (this.#paused) {
      return;
    }
    const waiting = this.#waiting;
    const running = [...this.#running];
    const starting = jobsToStart(
      waiting.map((job) => prioritized(job)),
      running.map((job) => prioritized(job)),
      this.#focused ? FOCUSED_LIMITS : LIMITS,
    ).map((index) => waiting[index] as Job);
    // Taken out of the waiting list first, because work that starts may ask for more work.
    this.#waiting = waiting.filter((job) => !starting.includes(job));
    for (const job of starting) {
      this.#start(job);
    }
  }

  #start(job: Job) {
    this.#running.add(job);
    Promise.resolve()
      .then(() => job.work(this.signal, () => priorityOf(job)))
      .then(job.result.resolve, async (error: unknown) => {
        if (!this.signal.aborted && (await this.failedOffline(error))) {
          this.#waiting.push(job);
        } else {
          job.result.reject(error);
        }
      })
      .finally(() => {
        this.#running.delete(job);
        this.reschedule();
      });
  }
}
