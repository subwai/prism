import { DelayedCall, type WorkerEvent } from '@prism/shared';

// Folders whose subfolders changed, and folders whose tiles changed, are sent together, at most
// this often, so a library read for the first time sends its thousands of folders in a few
// batches.
const FOLDER_CHANGES_MS = 250;

/** Folders whose listing or tiles changed, as the library reports them. */
interface FolderChanges {
  /** Folders whose subfolders changed. */
  folders: string[];
  /** Folders whose tiles changed. */
  tiles: string[];
}

/**
 * Sends the windows the folders that changed, in batches. Calling `report` adds to the next
 * batch, which goes out a moment after the first folder in it, as one `update` event.
 */
export function folderChangeReports(send: (event: WorkerEvent) => void) {
  const foldersChanged = new Set<string>();
  const tilesChanged = new Set<string>();

  function sendBatch() {
    send({
      kind: 'update',
      update: {
        changes: null,
        folders: [...foldersChanged],
        tiles: [...tilesChanged],
        views: [],
      },
    });
    foldersChanged.clear();
    tilesChanged.clear();
  }
  const sendBatchSoon = new DelayedCall(sendBatch, FOLDER_CHANGES_MS);

  /** Adds `folderIds` to `pending`, to go out with the next batch. */
  function addToBatch(pending: Set<string>, folderIds: string[]) {
    if (folderIds.length === 0) {
      return;
    }
    sendBatchSoon.request();
    for (const folderId of folderIds) {
      pending.add(folderId);
    }
  }

  return {
    report({ folders, tiles }: FolderChanges): void {
      addToBatch(foldersChanged, folders);
      addToBatch(tilesChanged, tiles);
    },
  };
}
