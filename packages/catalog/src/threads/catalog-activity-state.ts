import type { CatalogActivity } from '#threads/busy-change';
import { Listeners } from '@prism/shared';

/** What the catalog is busy with, as its threads report it, and who hears when that changes. */
export class CatalogActivityState {
  readonly #listeners = new Listeners();
  readonly #activity: CatalogActivity = {
    details: null,
    forgettingDetails: null,
    rebuildingTree: false,
    rebuildingViews: false,
    unsavedEntries: 0,
  };

  /** What the catalog is busy with now. */
  current(): CatalogActivity {
    return { ...this.#activity };
  }

  /** Hears as what the catalog is busy with changes. */
  onChange(listener: () => void): () => void {
    return this.#listeners.add(listener);
  }

  /** Notes what a thread reported, such as a job starting, and tells those listening. */
  update(changes: Partial<CatalogActivity>): void {
    Object.assign(this.#activity, changes);
    this.#listeners.tell();
  }

  /** Counts `entries` more handed to the writer and not yet answered, or fewer if negative. */
  addUnsaved(entries: number): void {
    this.update({ unsavedEntries: this.#activity.unsavedEntries + entries });
  }
}
