import { DroppedError } from '#photos/worker/dropped-error';
import {
  CAPACITY,
  FOCUSED_LIMITS,
  LIMITS,
  PRIORITIES,
  type Priority,
  startable,
} from '#photos/worker/scheduling';
import { type Jobs, type Lane, LANES } from '@prism/shared';

/** Says how much a job matters now, `null` once nothing wants it. */
export type Want = () => Priority | null;

/** Wanted as what the window waits for, such as a folder it lists or a photo the viewer opens. */
export const VISIBLE: Want = () => 'visible';

interface Job {
  lane: Lane;
  key: string;
  /** Everyone who asked for it, of whom the one who wants it most decides its priority. */
  wants: Want[];
  work: (signal: AbortSignal, wants: Want) => Promise<unknown>;
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

function count(jobs: Iterable<Job>, lane: Lane) {
  return [...jobs].filter((job) => job.lane === lane).length;
}

function weigh(job: Job) {
  return { lane: job.lane, priority: priorityOf(job) };
}

/**
 * The one place a folder's worker orders its disk work: thumbnails, conversions, folders' reads,
 * tiles and photos' details. Each job says how much it is wanted each time the scheduler looks,
 * so work follows what the window shows as it changes; see `scheduling.ts` for the order and the
 * limits. Jobs of a lane share their key, as two asking for one thumbnail share its making.
 * While the disk is offline, nothing starts, and a job that `lost` says failed as it went
 * offline waits its turn again, so work waits for the disk rather than failing over and over.
 */
export class Scheduler {
  #waiting: Job[] = [];
  readonly #running = new Set<Job>();
  readonly #listeners = new Set<() => void>();
  #pumping = false;
  #focused = false;
  #paused = false;

  constructor(
    private readonly signal: AbortSignal,
    private readonly lost: (error: unknown) => Promise<boolean> = () => Promise.resolve(false),
  ) {}

  /**
   * Runs `work` once the scheduler gives it its turn, or joins the job of `lane` under `key` that
   * waits or runs already. It is dropped, rejecting with `DroppedError`, if before its turn no one
   * who asked for it `wants` it any more. Rejects at once if the lane is full, or the worker is
   * closing. `work` is handed how much the job is wanted, by whoever wants it most, for work it
   * waits on in turn.
   */
  run<Value>(
    lane: Lane,
    key: string,
    wants: Want,
    work: (signal: AbortSignal, wants: Want) => Promise<Value>,
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

  /** How many jobs of each lane run, and how many wait their turn. */
  jobs(): Record<Lane, Jobs> {
    return Object.fromEntries(
      LANES.map((lane) => [
        lane,
        { running: count(this.#running, lane), waiting: count(this.#waiting, lane) },
      ]),
    ) as Record<Lane, Jobs>;
  }

  /**
   * Says whether a Prism window is focused, while which more photos' details are read at once in
   * the background (`FOCUSED_LIMITS`). Work already running goes on either way.
   */
  focus(focused: boolean): void {
    this.#focused = focused;
    this.reconsider();
  }

  /**
   * Says whether the disk is offline, while which no job starts, though work already running goes
   * on, and jobs wait, or are dropped as nothing wants them any more.
   */
  pause(paused: boolean): void {
    this.#paused = paused;
    this.reconsider();
  }

  /** Hears whenever jobs may have started, finished or been dropped; see `jobs`. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
    for (const listener of this.#listeners) {
      listener();
    }
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
    if (this.#paused) {
      return;
    }
    const waiting = this.#waiting;
    const running = [...this.#running];
    const starting = startable(
      waiting.map((job) => weigh(job)),
      running.map((job) => weigh(job)),
      this.#focused ? FOCUSED_LIMITS : LIMITS,
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
      .then(() => job.work(this.signal, () => priorityOf(job)))
      .then(job.result.resolve, async (error: unknown) => {
        if (!this.signal.aborted && (await this.lost(error))) {
          this.#waiting.push(job);
        } else {
          job.result.reject(error);
        }
      })
      .finally(() => {
        this.#running.delete(job);
        this.reconsider();
      });
  }
}
