import { fileResponse } from '#photos/main/file-response';
import { listedKeyOf, listedThumbnailFile } from '#photos/main/listed-thumbnail';
import { sessionWithId } from '#photos/main/sessions';
import { mainThumbnailCache } from '#photos/main/thumbnail-directory';
import { rendererOrigin } from '#renderer-url';
import { markUsed, thumbnailFile } from '@prism/media';
import { needsConversion } from '@prism/shared';
import { protocol } from 'electron';

const METHOD_NOT_ALLOWED = 405;
const NOT_FOUND = 404;

/** The URL that shows `entryId` of `session`, valid while the session is open. */
export function originalURL(sessionId: string, entryId: string): string {
  return `media://original/${sessionId}/${encodeURIComponent(entryId)}`;
}

/** The file of the cached thumbnail `key`, marked as used so the cache keeps it. */
function serveCachedThumbnail(key: string): MediaContent {
  const cache = mainThumbnailCache();
  markUsed(cache, key);
  return { file: thumbnailFile(cache.directory, key), kind: 'file' };
}

/** The open session and entry a URL's path names, as `/<session>/<entry>`. */
function entryNamedBy(url: URL) {
  const [, sessionId = '', encoded] = url.pathname.split('/');
  const session = sessionWithId(sessionId);
  return session && encoded ? { entryId: decodeURIComponent(encoded), session } : null;
}

// Enough for every tile of a long scroll; each is a URL and a key, a few hundred bytes.
const MAX_KNOWN_THUMBNAILS = 50_000;

/**
 * The cached thumbnails the worker found for entries whose URL does not name theirs (see
 * `listedKeyOf`), by the URL that asked. The worker checks the photo itself to find one, which
 * on a busy network share takes long enough to see, and a tile asks again each time it scrolls
 * back into view. The URL names the session and changes as the file or a refresh does, so the
 * thumbnail it found stays the one it names. A change the watcher cannot see, as most are on a
 * share, shows after a refresh, as it does in the listing.
 */
const knownThumbnails = new Map<string, string>();

function rememberThumbnail(url: string, key: string) {
  knownThumbnails.set(url, key);
  // The oldest go first, as a map lists its keys in the order they were set.
  for (const oldest of knownThumbnails.keys()) {
    if (knownThumbnails.size <= MAX_KNOWN_THUMBNAILS) {
      break;
    }
    knownThumbnails.delete(oldest);
  }
}

/** What a `media:` URL serves: a file on disk, or bytes the worker converted. */
type MediaContent =
  | { kind: 'file'; file: string }
  | { kind: 'bytes'; data: Uint8Array; type: string };

/**
 * The thumbnail a `media://thumbnail/` URL names: by its key, or an entry's thumbnail if it is
 * cached (see `cachedThumbnailURL`). An entry's is found from what the URL says of the file
 * where it says enough, and by asking the worker otherwise.
 */
async function thumbnailContent(url: URL): Promise<MediaContent | null> {
  const key = /^\/(?<key>[a-f\d]{64})\.webp$/u.exec(url.pathname)?.groups?.key;
  if (key) {
    return serveCachedThumbnail(key);
  }
  const known = knownThumbnails.get(url.href);
  if (known) {
    return serveCachedThumbnail(known);
  }
  const named = entryNamedBy(url);
  const listed = named && listedKeyOf(url, named.entryId);
  if (listed) {
    const file = await listedThumbnailFile(mainThumbnailCache(), listed);
    return file ? { file, kind: 'file' } : null;
  }
  const cached = named && (await named.session.client.call('cachedThumbnail', named.entryId));
  if (cached) {
    rememberThumbnail(url.href, cached);
  }
  return cached ? serveCachedThumbnail(cached) : null;
}

/**
 * The original a `media://original/` URL names in an open folder. A HEIF or TIFF original is an
 * image the worker converted, which the window can show.
 */
async function originalContent(url: URL): Promise<MediaContent | null> {
  const named = entryNamedBy(url);
  if (!named) {
    return null;
  }
  const { entryId, session } = named;
  if (needsConversion(entryId)) {
    return { ...(await session.client.call('convertedOriginal', entryId)), kind: 'bytes' };
  }
  return { file: await session.client.call('original', entryId), kind: 'file' };
}

/** What a `media:` URL names, or `null` if nothing. */
function contentFor(url: URL): Promise<MediaContent | null> {
  switch (url.host) {
    case 'thumbnail': {
      return thumbnailContent(url);
    }
    case 'original': {
      return originalContent(url);
    }
    default: {
      return Promise.resolve(null);
    }
  }
}

/** Serves thumbnails and originals to the window, with byte ranges for videos. */
export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('', { status: METHOD_NOT_ALLOWED });
    }
    const url = new URL(request.url);
    try {
      const content = await contentFor(url);
      // The window draws videos to take their stills, which needs them shared with it.
      const headers = new Headers({ 'Access-Control-Allow-Origin': rendererOrigin() });
      switch (content?.kind) {
        case 'bytes': {
          headers.set('Content-Type', content.type);
          return new Response(request.method === 'HEAD' ? null : content.data, { headers });
        }
        case 'file': {
          return await fileResponse(content.file, request, headers);
        }
        default: {
          break;
        }
      }
    } catch {
      // Removed files and closed sessions are normal while browsing. A thumbnail the cache
      // trimmed is looked for again, and then made.
      knownThumbnails.delete(url.href);
    }
    return new Response('', { status: NOT_FOUND });
  });
}
