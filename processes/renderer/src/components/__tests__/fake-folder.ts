import { cachedThumbnails } from '#components/__tests__/served-thumbnails';
import { fakeAPI, sendThumbnail } from '#data/__tests__/fixtures';
import { treeListingOf, treeListingOfFolders } from '#data/__tests__/tree-listings';
import {
  type FolderContents,
  type FolderSummary,
  type PhotoEntry,
  type PhotoRoot,
  type SerializedTreeListing,
  type ThumbnailResult,
  type TreeFolderCover,
  treeListingToText,
} from '@prism/shared';
// Six seconds of a silent VP9 test pattern, shared with the end-to-end tests, which play it in
// the app. Chromium for testing cannot play their H.264 one.
import clip from '@prism/test-media/clip.webm?url';
// The end-to-end tests' photos. Encoding photos this large in the page takes several seconds
// on CI's runners, so these are files rather than painted.
import landscape from '@prism/test-media/landscape.jpg?url';
import portrait from '@prism/test-media/portrait.jpg?url';
import small from '@prism/test-media/small.jpg?url';

/**
 * A photo of one colour, a video, or a folder of more of them, by name. A photo is painted the
 * first time it is asked for, unless it has the `url` of a file of it.
 */
export type FakeEntry =
  | { name: string; color: string; width: number; height: number; url?: string }
  | { name: string; video: true }
  | { name: string; children: FakeEntry[] };

const ROOT: PhotoRoot = { id: '.', location: 'local', name: 'Pictures', session: 'test' };

/**
 * As the end-to-end tests' folder: photos large enough that fitting them shrinks them, and one
 * not, after two videos, which sort first.
 */
export const PHOTOS: FakeEntry[] = [
  { name: 'clip.webm', video: true },
  { name: 'film.webm', video: true },
  { color: '#2a5d9f', height: 3000, name: 'landscape.jpg', url: landscape, width: 4000 },
  { color: '#8a6d2f', height: 3600, name: 'portrait.jpg', url: portrait, width: 2400 },
  { color: '#3f8a4f', height: 400, name: 'small.jpg', url: small, width: 600 },
];

function kindOf(fake: FakeEntry): PhotoEntry['kind'] {
  if ('children' in fake) {
    return 'directory';
  }
  return 'video' in fake ? 'video' : 'image';
}

/**
 * The tile of a folder holding `listed`, as the catalog keeps it: its own photos and videos,
 * photos first, or those of the first folder inside it with any.
 */
function tileOf(listed: PhotoEntry[]): FolderSummary {
  const media = listed.filter((entry) => entry.kind === 'image' || entry.kind === 'video');
  const own = media.toSorted(
    (left, right) => Number(left.kind === 'video') - Number(right.kind === 'video'),
  );
  const lent = listed.find((entry) => (entry.summary?.covers.length ?? 0) > 0);
  return {
    covers: own.length > 0 ? own.slice(0, 4) : (lent?.summary?.covers ?? []),
    hasEntries: listed.length > 0,
    hasSubfolders: listed.some((entry) => entry.kind === 'directory'),
    read: true,
  };
}

/** The catalog's tree listing of the folders among `entries`, with their tiles, and the root's. */
function catalogTreeListing(entries: PhotoEntry[], root: FolderSummary): SerializedTreeListing {
  const folders = entries.filter((entry) => entry.kind === 'directory');
  const covers = [...folders.map((folder) => folder.summary), root].map((summary) =>
    (summary?.covers ?? []).map((cover): TreeFolderCover => [
      cover.id,
      cover.kind === 'video' ? 'video' : 'image',
      0,
      0,
      null,
    ]),
  );
  return treeListingOf(
    folders.map((folder, at) => [
      folder.id,
      folder.parentId,
      folder.name,
      [
        folder.summary?.hasEntries ?? false,
        folder.summary?.hasSubfolders ?? false,
        covers[at]?.length ? at : -1,
        true,
      ],
    ]),
    {
      covers,
      root: [
        root.hasEntries,
        root.hasSubfolders,
        covers.at(-1)?.length ? folders.length : -1,
        true,
      ],
    },
  );
}

/** Photos painted so far, kept for the page's session, as painting a large one takes a while. */
const painted = new Map<string, Promise<string>>();

/** A JPEG of one colour, painted the first time it is asked for. */
function paint(color: string, width: number, height: number) {
  const key = `${color} ${width}×${height}`;
  let url = painted.get(key);
  if (!url) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
    }
    url = canvas.convertToBlob({ type: 'image/jpeg' }).then((blob) => URL.createObjectURL(blob));
    painted.set(key, url);
  }
  return url;
}

/** A thumbnail of one colour, made at once, as a canvas can only make a data URL. */
function thumbnail(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL('image/jpeg');
}

/**
 * The app's photos API over `fakes`, as the library worker answers it: views, folders' contents and
 * the tree's folders, whose rows hold their tiles, thumbnails and originals. Originals are made as
 * they are first asked for, and the photos' thumbnails are cached from the start; mock
 * `cachedThumbnailURL` with `servedThumbnailURL` to show them by it, as the app does. Ids are paths
 * from the root.
 */
export function fakeFolder(fakes: FakeEntry[]) {
  const found = new Map<string, { entry: PhotoEntry; fake: FakeEntry }>();
  const children = new Map<string, PhotoEntry[]>();
  function add(inside: FakeEntry[], parentId: string) {
    children.set(
      parentId,
      inside.map((fake) => {
        const id = parentId === ROOT.id ? fake.name : `${parentId}/${fake.name}`;
        const entry: PhotoEntry = { id, kind: kindOf(fake), name: fake.name, parentId };
        found.set(id, { entry, fake });
        if ('children' in fake) {
          add(fake.children, id);
          // Its row has its tile, once what is inside it is known.
          entry.summary = tileOf(children.get(id) ?? []);
        }
        return entry;
      }),
    );
  }
  add(fakes, ROOT.id);
  // The photos' thumbnails are cached already, as in a folder the app has shown before.
  for (const [id, { fake }] of found) {
    if ('color' in fake) {
      cachedThumbnails.set(id, thumbnail(fake.color));
    }
  }
  const entries = [...found.values()].map(({ entry }) => entry);
  // Views show what of these they hold, as the worker's catalog does once it has read them.
  const api = fakeAPI([], entries);
  api.openFolder.mockResolvedValue(ROOT);
  api.listFolder.mockImplementation((directoryId) =>
    Promise.resolve<FolderContents>({
      entries: children.get(directoryId) ?? [],
      error: null,
      missing: false,
      read: true,
    }),
  );
  const rootTile = tileOf(children.get(ROOT.id) ?? []);
  api.listSubfolders.mockImplementation(() =>
    Promise.resolve(catalogTreeListing(entries, rootTile)),
  );
  api.listFoldersById.mockImplementation((ids) =>
    Promise.resolve(treeListingOfFolders(catalogTreeListing(entries, rootTile), ids)),
  );
  api.listWholeTree.mockImplementation(() =>
    Promise.resolve(treeListingToText(catalogTreeListing(entries, rootTile))),
  );
  api.getOriginalURL.mockImplementation((id) => {
    const fake = found.get(id)?.fake;
    if (fake && 'color' in fake) {
      return fake.url ? Promise.resolve(fake.url) : paint(fake.color, fake.width, fake.height);
    }
    return Promise.resolve(fake && 'video' in fake ? clip : `media://original/${id}`);
  });
  // The worker makes the thumbnail of each photo and video as it comes on screen, and sends it.
  let shown = new Set<string>();
  api.reportScreenContents.mockImplementation((contents) => {
    const before = shown;
    shown = new Set(contents.shown);
    for (const entryId of contents.shown.filter((id) => !before.has(id))) {
      const fake = found.get(entryId)?.fake;
      if (fake && 'children' in fake) {
        continue;
      }
      const url = cachedThumbnails.get(entryId);
      // The window takes a still image of a video itself, as it does of those the system cannot.
      let result: ThumbnailResult = { message: 'No thumbnail.', status: 'failed' };
      if (url) {
        result = { status: 'ready', url };
      } else if (fake && 'video' in fake) {
        result = { status: 'still-image-needed' };
      }
      sendThumbnail(api, { entryId, ...result });
    }
    return Promise.resolve();
  });
  api.storeThumbnail.mockImplementation(({ entryId, image }) => {
    const url = URL.createObjectURL(
      new Blob([image as Uint8Array<ArrayBuffer>], { type: 'image/webp' }),
    );
    cachedThumbnails.set(entryId, url);
    return Promise.resolve({ status: 'ready', url });
  });
  return api;
}
