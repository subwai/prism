import type { CatalogFiles } from '#database/connections';
import { prepareIndex } from '#database/photo-index/open';
import { prepareRatings } from '#database/ratings/open';
import { type Connect, inProcessHost } from '#threads/channels';
import { Catalog } from '#threads/client';
import { treeListingFromText } from '@prism/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';

/** A catalog's files in a folder of their own, as the app keeps them. */
export function catalogFiles(): CatalogFiles {
  const folder = mkdtempSync(path.join(tmpdir(), 'catalog-'));
  onTestFinished(() => rmSync(folder, { force: true, recursive: true }));
  return {
    index: prepareIndex(path.join(folder, 'index.db')),
    ratings: prepareRatings(path.join(folder, 'ratings.db')),
  };
}

/** A catalog of the library at `/library`, its hosts started by `connect`. */
export function openCatalog(files = catalogFiles(), connect: Connect = inProcessHost) {
  const catalog = new Catalog(files, '/library', connect);
  onTestFinished(() => catalog.close());
  return catalog;
}

/** Hosts on this thread whose writer answers nothing from a call to `method` until `release`. */
export function heldCalls(method: string) {
  const held: (() => void)[] = [];
  const connect: Connect = (role, receive) => {
    const channel = inProcessHost(role, receive);
    return {
      close: channel.close,
      post(message) {
        const busy = held.length > 0 || ('method' in message && message.method === method);
        if (role.role === 'writer' && busy) {
          held.push(() => channel.post(message));
        } else {
          channel.post(message);
        }
      },
    };
  };
  return {
    connect,
    release() {
      for (const post of held.splice(0)) {
        post();
      }
    },
  };
}

/** The IDs of the folders a tree listing sent as text holds. */
export function folders(listing: string) {
  return treeListingFromText(listing).folders.flatMap(([, subfolders]) =>
    subfolders.map(([id]) => id),
  );
}

export async function ids(catalog: Catalog, directoryId = '.') {
  return (await catalog.call('entriesIn', directoryId)).map((row) => row.id);
}
