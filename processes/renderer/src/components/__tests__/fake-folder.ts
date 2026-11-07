import { cachedThumbnails } from '#components/__tests__/served-thumbnails';
import { fakeAPI } from '#data/__tests__/fixtures';
// Six seconds of a silent VP9 test pattern, shared with the end-to-end tests, which play it in
// the app. Chromium for testing cannot play their H.264 one.
import clip from '../../../../../e2e/support/media/clip.webm?url';
import type {
  FolderListing,
  FolderSummary,
  PhotoEntry,
  PhotoRoot,
  ThumbnailResult,
} from '@prism/shared';

/** A photo of one colour, a video, or a folder of more of them, by name. */
export type FakeItem =
  | { name: string; color: string; width: number; height: number }
  | { name: string; video: true }
  | { name: string; children: FakeItem[] };

const ROOT: PhotoRoot = { id: '.', location: 'local', name: 'Pictures', session: 'test' };

/**
 * As the end-to-end tests' folder: photos large enough that fitting them shrinks them, and one
 * not, after two videos, which sort first.
 */
export const PHOTOS: FakeItem[] = [
  { name: 'clip.webm', video: true },
  { name: 'film.webm', video: true },
  { color: '#2a5d9f', height: 3000, name: 'landscape.jpg', width: 4000 },
  { color: '#8a6d2f', height: 3600, name: 'portrait.jpg', width: 2400 },
  { color: '#3f8a4f', height: 400, name: 'small.jpg', width: 600 },
];

function kindOf(item: FakeItem): PhotoEntry['kind'] {
  if ('children' in item) {
    return 'directory';
  }
  return 'video' in item ? 'video' : 'image';
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
 * The app's photos API over `items`, as the folder's worker answers it: views, listings,
 * covers, thumbnails and originals. Originals are made as they are first asked for, and the
 * photos' thumbnails are cached from the start; mock `cachedThumbnailURL` with
 * `servedThumbnailURL` to show them by it, as the app does. Ids are paths from the root.
 */
export function fakeFolder(items: FakeItem[]) {
  const found = new Map<string, { entry: PhotoEntry; item: FakeItem }>();
  const children = new Map<string, PhotoEntry[]>();
  function add(inside: FakeItem[], parentId: string) {
    children.set(
      parentId,
      inside.map((item) => {
        const id = parentId === ROOT.id ? item.name : `${parentId}/${item.name}`;
        const entry: PhotoEntry = { id, kind: kindOf(item), name: item.name, parentId };
        found.set(id, { entry, item });
        if ('children' in item) {
          add(item.children, id);
        }
        return entry;
      }),
    );
  }
  add(items, ROOT.id);
  // The photos' thumbnails are cached already, as in a folder the app has shown before.
  for (const [id, { item }] of found) {
    if ('color' in item) {
      cachedThumbnails.set(id, thumbnail(item.color));
    }
  }
  // Views show what of these they hold, as the worker's catalog does once it has read them.
  const api = fakeAPI(
    [],
    [...found.values()].map(({ entry }) => entry),
  );
  api.openFolder.mockResolvedValue(ROOT);
  api.listFolder.mockImplementation((directoryId) =>
    Promise.resolve<FolderListing>({
      entries: children.get(directoryId) ?? [],
      error: null,
      errors: [],
    }),
  );
  api.inspectFolder.mockImplementation((directoryId) => {
    const listed = children.get(directoryId) ?? [];
    return Promise.resolve<FolderSummary>({
      covers: listed.filter((entry) => entry.kind === 'image' || entry.kind === 'video'),
      hasEntries: listed.length > 0,
      hasSubfolders: listed.some((entry) => entry.kind === 'directory'),
    });
  });
  api.getOriginalURL.mockImplementation((id) => {
    const item = found.get(id)?.item;
    if (item && 'color' in item) {
      return paint(item.color, item.width, item.height);
    }
    return Promise.resolve(item && 'video' in item ? clip : `media://original/${id}`);
  });
  api.requestThumbnail.mockImplementation((id) => {
    const item = found.get(id)?.item;
    const url = cachedThumbnails.get(id);
    if (url) {
      return Promise.resolve<ThumbnailResult>({ status: 'ready', url });
    }
    // The window takes a still of a video itself, as it does of those the system cannot.
    return Promise.resolve<ThumbnailResult>(
      item && 'video' in item
        ? { status: 'frame-needed' }
        : { message: 'No thumbnail.', status: 'failed' },
    );
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
