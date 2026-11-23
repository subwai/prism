import type { FolderRead } from '#photos/worker/indexer/index-run';
import { idsWithin, movedId } from '#photos/worker/library/entry-ids';

/**
 * What the indexer knows of its folders this session: which it read, which it is reading, and
 * which failed. A folder that changes is forgotten, so the next request reads it again.
 */
export class FolderSession {
  /** Folders read this session. The watcher keeps them up to date after that. */
  readonly current = new Set<string>();
  /** Folders whose reads are under way. */
  readonly reading = new Set<string>();
  /** Folders whose last read this session failed, until one succeeds or they are forgotten. */
  readonly failed = new Map<string, FolderRead>();
  /** Folders forgotten while a read of them was under way. That read must not mark them current. */
  readonly stale = new Set<string>();

  /** Every folder read, being read, or failed this session. */
  private known() {
    return [...this.current, ...this.reading, ...this.failed.keys()];
  }

  /** Marks folders to be read again because they changed; every folder if none are given. */
  forget(folderIds?: Iterable<string>): void {
    for (const id of folderIds ? [...folderIds] : this.known()) {
      this.current.delete(id);
      this.failed.delete(id);
      if (this.reading.has(id)) {
        this.stale.add(id);
      }
    }
  }

  /** Forgets `folderId` and every folder inside it, which went away with it. */
  forgetInside(folderId: string): void {
    this.forget(idsWithin(folderId, this.known()));
  }

  /**
   * Notes that the app moved `from` to `to` together with its rows. What was read inside it still
   * holds, under the new IDs. Reads under way wrote under the old IDs, so those folders are left
   * to the next read.
   */
  moved(from: string, to: string): void {
    const read = idsWithin(from, this.current);
    this.forgetInside(from);
    for (const id of read) {
      this.current.add(movedId(id, from, to));
    }
  }
}
