import type { CatalogViews, ViewVersion } from '#services/views/catalog-views';
import type { MadeOrder } from '#services/views/view-orders';
import { readsDetails, refreshGap } from '#services/views/view-pacing';
import { OneAtATimeQueue, type ViewFacets, type ViewSpec } from '@prism/shared';

/**
 * The views' thread, which makes a view's order as the catalog is, at the reader's `generation`,
 * and counts its photos still to read and its values to filter by, off the reader's thread:
 * counting the suggestions of a library of 1.8 million takes 130–600 ms, which the window's reads
 * would otherwise wait for.
 */
export interface ViewThread {
  make: (spec: ViewSpec, generation: number) => Promise<MadeOrder>;
  unread: (spec: ViewSpec) => Promise<number>;
  facets: (spec: ViewSpec) => Promise<ViewFacets['fields']>;
}

/**
 * The reader's views waiting to have `thread` make their orders again, as the catalog changes
 * under them, no more often than they can be (see `refreshGap`). Each waits once, however often
 * it is asked for, and one is made at a time, the most recently used first, so a view just opened
 * goes next. A view that only photos' details came in for since, and whose order reads none of
 * them, keeps its order and only counts again. Each new version is `told` as well as answered.
 */
export class ViewQueue {
  /**
   * Goes up with every write the reader learns of. A view built at an older number may be out of
   * date.
   */
  #generation = 0;
  /** The generation of the last write that changed more than photos' details. */
  #lastOtherWrite = 0;
  /** When each view was last made, and how long that took. */
  readonly #timings = new Map<string, { at: number; took: number }>();
  #timer: NodeJS.Timeout | undefined;
  /** The views waiting to be made, and the one being made. */
  readonly #queue = new OneAtATimeQueue<string, ViewVersion | null>({
    busy: (busy) => {
      this.busy(busy);
      if (!busy) {
        this.#schedule();
      }
    },
    pickNext: (isWaiting) => this.#mostRecentlyUsed(isWaiting),
    work: (viewId) => this.#makeNow(viewId),
  });

  constructor(
    private readonly views: CatalogViews,
    private readonly thread: ViewThread,
    private readonly told: (viewId: string, version: ViewVersion) => void,
    /** Hears as it starts making views, and once none is left to make. */
    private readonly busy: (busy: boolean) => void = () => null,
  ) {}

  /**
   * Called on every write. The views built before it are built again when they are due, and
   * later if the write changed `onlyDetails`.
   */
  changed(onlyDetails: boolean): void {
    this.#generation += 1;
    if (!onlyDetails) {
      this.#lastOtherWrite = this.#generation;
    }
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
    return this.#queue.want(viewId);
  }

  /** Forgets a view the reader closed, whose callers hear `null`; what is made of it is dropped. */
  forget(viewId: string): void {
    this.#queue.drop(viewId, null);
    this.#timings.delete(viewId);
  }

  /** Makes no more views once due; the reader closes them. */
  stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Of the views `isWaiting` says wait, the one used most recently; `null` if none. */
  #mostRecentlyUsed(isWaiting: (viewId: string) => boolean): string | null {
    return this.views.byUse().find(({ viewId }) => isWaiting(viewId))?.viewId ?? null;
  }

  /** Makes the view as the catalog is now, unless it is still as made; `null` once closed. */
  async #makeNow(viewId: string): Promise<ViewVersion | null> {
    const spec = this.views.specOf(viewId);
    const generation = this.#generation;
    if (!spec || !this.views.stale(generation).includes(viewId)) {
      return this.views.versionOf(viewId);
    }
    const started = performance.now();
    // A view whose order reads no details keeps it as they come in, and only counts again.
    const ordering =
      this.#onlyDetailsSince(viewId) && !readsDetails(spec)
        ? Promise.resolve(this.views.currentOrder(viewId, generation))
        : this.thread.make(spec, generation);
    // Timed even if it fails, so it is tried again no sooner than it would be made again.
    const [made, unread] = await Promise.all([ordering, this.thread.unread(spec)]).finally(() => {
      const at = performance.now();
      if (this.views.specOf(viewId)) {
        this.#timings.set(viewId, { at, took: at - started });
      }
    });
    const version = made && this.views.addVersion(viewId, made, unread);
    if (version) {
      this.told(viewId, version);
    }
    return version;
  }

  /** Whether every write since the view was made changed only photos' details. */
  #onlyDetailsSince(viewId: string) {
    return (this.views.generationOf(viewId) ?? -1) >= this.#lastOtherWrite;
  }

  /** When a view may be made again. */
  #dueAt(viewId: string) {
    const timing = this.#timings.get(viewId);
    return timing ? timing.at + refreshGap(timing.took, this.#onlyDetailsSince(viewId)) : 0;
  }

  /** The views the catalog changed under, which are neither being made nor waiting to be. */
  #unasked() {
    return this.views.stale(this.#generation).filter((viewId) => !this.#queue.isAsked(viewId));
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
