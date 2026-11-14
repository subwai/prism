import type { MadeOrder } from '#view-orders';
import type { CatalogViews, ViewVersion } from '#views';
import type { ViewSpec } from '@prism/shared';

// A view is made again at most this often while the catalog changes under it, or twice as
// long as making it took, whichever is longer, so a large one leaves time to make the others.
const MIN_REFRESH_MS = 500;

/** Makes a view's order as the catalog is, at the reader's `generation`, off its thread. */
export type MakeOrder = (spec: ViewSpec, generation: number) => Promise<MadeOrder>;

/**
 * The reader's views waiting to have `make` make their orders again, as the catalog changes
 * under them, no more often than they can be. Each waits once, however often it is asked for,
 * and one is made at a time, the most recently used first, so a view just opened goes next.
 * Each new version is `told` as well as answered.
 */
export class ViewQueue {
  /** Bumped by every write the reader hears of, which tells views whose order may have changed. */
  #generation = 0;
  /** When each view was last made, and how long that took. */
  readonly #timings = new Map<string, { at: number; took: number }>();
  #timer: NodeJS.Timeout | undefined;
  /** The views waiting to be made, with what waits for each. */
  readonly #waiting = new Map<string, PromiseWithResolvers<ViewVersion | null>>();
  /** The view being made. */
  #making: string | undefined;

  constructor(
    private readonly views: CatalogViews,
    private readonly make: MakeOrder,
    private readonly told: (viewId: string, version: ViewVersion) => void,
  ) {}

  /** Hears of a write, after which the views made before it are made again once due. */
  changed(): void {
    this.#generation += 1;
    this.#schedule();
  }

  /**
   * Makes the view again once those before it are made, if the catalog changed under it by
   * then; its version as it is if it has not. `null` once it is closed.
   */
  want(viewId: string): Promise<ViewVersion | null> {
    if (!this.views.stale(this.#generation).includes(viewId)) {
      return Promise.resolve(this.views.versionOf(viewId));
    }
    let waiter = this.#waiting.get(viewId);
    if (!waiter) {
      waiter = Promise.withResolvers();
      this.#waiting.set(viewId, waiter);
      this.#makeWaiting();
    }
    return waiter.promise;
  }

  /** Forgets a view the reader closed, whose callers hear `null`; what is made of it is dropped. */
  forget(viewId: string): void {
    this.#waiting.get(viewId)?.resolve(null);
    this.#waiting.delete(viewId);
    this.#timings.delete(viewId);
  }

  /** Makes no more views once due; the reader closes them. */
  stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Makes the views waiting, one at a time, unless that is under way. */
  async #makeWaiting() {
    if (this.#making !== undefined) {
      return;
    }
    let next = this.#nextWaiting();
    while (next) {
      const [viewId, waiter] = next;
      this.#waiting.delete(viewId);
      this.#making = viewId;
      try {
        waiter.resolve(await this.#makeNow(viewId));
      } catch (error) {
        waiter.reject(error);
      } finally {
        this.#making = undefined;
      }
      next = this.#nextWaiting();
    }
    this.#schedule();
  }

  /** The view waiting that was used most recently, and what waits for it. */
  #nextWaiting() {
    for (const { viewId } of this.views.byUse()) {
      const waiter = this.#waiting.get(viewId);
      if (waiter) {
        return [viewId, waiter] as const;
      }
    }
    return null;
  }

  /** Makes the view as the catalog is now, unless it is still as made; `null` once closed. */
  async #makeNow(viewId: string): Promise<ViewVersion | null> {
    const spec = this.views.specOf(viewId);
    const generation = this.#generation;
    if (!spec || !this.views.stale(generation).includes(viewId)) {
      return this.views.versionOf(viewId);
    }
    const started = performance.now();
    // Timed even if it fails, so it is tried again no sooner than it would be made again.
    const made = await this.make(spec, generation).finally(() => {
      const at = performance.now();
      if (this.views.specOf(viewId)) {
        this.#timings.set(viewId, { at, took: at - started });
      }
    });
    const version = this.views.use(viewId, made);
    if (version) {
      this.told(viewId, version);
    }
    return version;
  }

  /** When a view may be made again. */
  #dueAt(viewId: string) {
    const timing = this.#timings.get(viewId);
    return timing ? timing.at + Math.max(MIN_REFRESH_MS, timing.took * 2) : 0;
  }

  /** The views the catalog changed under, which are neither being made nor waiting to be. */
  #unasked() {
    return this.views
      .stale(this.#generation)
      .filter((viewId) => viewId !== this.#making && !this.#waiting.has(viewId));
  }

  /** Asks for the views the catalog changed under once they are due. */
  #schedule() {
    const stale = this.#unasked();
    if (this.#timer || stale.length === 0) {
      return;
    }
    const due = Math.min(...stale.map((viewId) => this.#dueAt(viewId)));
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        for (const viewId of this.#unasked()) {
          if (this.#dueAt(viewId) <= performance.now()) {
            // Told as it is made, and asked for by no one.
            this.want(viewId).catch(() => null);
          }
        }
        this.#schedule();
      },
      Math.max(0, due - performance.now()),
    );
  }
}
