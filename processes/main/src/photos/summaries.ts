import type { FolderSummary } from '@prism/shared';

const MAX_SUMMARIES = 2048;

/**
 * What scans and inspections found directly inside each folder, until the watcher sees it
 * change or the window refreshes. A read that was under way when its folder was forgotten saw
 * it as it was, so it is not remembered: it would outlast the change.
 */
export class SummaryCache {
  private readonly summaries = new Map<string, FolderSummary>();
  /** How often each folder was forgotten, and every folder in `forgotAll`. */
  private readonly forgotten = new Map<string, number>();
  private forgotAll = 0;

  get(directoryId: string): FolderSummary | undefined {
    return this.summaries.get(directoryId);
  }

  /** Taken as a read of `directoryId` starts, for `remember` to tell if it is still current. */
  since(directoryId: string): string {
    return `${this.forgotAll}:${this.forgotten.get(directoryId) ?? 0}`;
  }

  /** Remembers `value`, unless `directoryId` was forgotten `since` it was read. */
  remember(directoryId: string, value: FolderSummary, since: string): void {
    if (this.since(directoryId) !== since) {
      return;
    }
    this.summaries.delete(directoryId);
    if (this.summaries.size >= MAX_SUMMARIES) {
      const oldest = this.summaries.keys().next();
      if (!oldest.done) {
        this.summaries.delete(oldest.value);
      }
    }
    this.summaries.set(directoryId, value);
  }

  /** Drops the summaries of `directoryIds`, or of every folder. */
  forget(directoryIds?: Iterable<string>): void {
    if (!directoryIds) {
      this.forgotAll += 1;
      this.forgotten.clear();
      this.summaries.clear();
      return;
    }
    for (const directoryId of directoryIds) {
      this.forgotten.set(directoryId, (this.forgotten.get(directoryId) ?? 0) + 1);
      this.summaries.delete(directoryId);
    }
  }
}
