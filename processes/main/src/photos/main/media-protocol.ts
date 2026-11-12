import { fileResponse } from '#photos/main/file-response';
import { sessionWithId } from '#photos/main/sessions';
import { thumbnailDirectory } from '#photos/main/thumbnail-directory';
import { rendererOrigin } from '#renderer-url';
import { needsConversion } from '@prism/shared';
import { protocol } from 'electron';
import path from 'node:path';

const METHOD_NOT_ALLOWED = 405;
const NOT_FOUND = 404;

/** The URL that shows `entryId` of `session`, valid while the session is open. */
export function originalURL(sessionId: string, entryId: string): string {
  return `media://original/${sessionId}/${encodeURIComponent(entryId)}`;
}

function thumbnailFile(key: string) {
  return { file: path.join(thumbnailDirectory(), `${key}.webp`) };
}

/** The open session and entry a URL's path names, as `/<session>/<entry>`. */
function entryIn(url: URL) {
  const [, sessionId = '', encoded] = url.pathname.split('/');
  const session = sessionWithId(sessionId);
  return session && encoded ? { entryId: decodeURIComponent(encoded), session } : null;
}

/**
 * What a `media:` URL names: a thumbnail by its key, an entry's thumbnail if it is cached (see
 * `cachedThumbnailURL`), or an original in an open folder. A HEIF or TIFF original is an image
 * the worker converted, which the window can show.
 */
async function contentFor(
  url: URL,
): Promise<{ file: string } | { data: Uint8Array; type: string } | null> {
  if (url.host === 'thumbnail') {
    const key = /^\/(?<key>[a-f\d]{64})\.webp$/u.exec(url.pathname)?.groups?.key;
    if (key) {
      return thumbnailFile(key);
    }
    const named = entryIn(url);
    const cached = named && (await named.session.client.call('cachedThumbnail', named.entryId));
    return cached ? thumbnailFile(cached) : null;
  }
  if (url.host === 'original') {
    const named = entryIn(url);
    if (named) {
      const { entryId, session } = named;
      return needsConversion(entryId)
        ? await session.client.call('convertedOriginal', entryId)
        : { file: await session.client.call('original', entryId) };
    }
  }
  return null;
}

/** Serves thumbnails and originals to the window, with byte ranges for videos. */
export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('', { status: METHOD_NOT_ALLOWED });
    }
    try {
      const content = await contentFor(new URL(request.url));
      // The window draws videos to take their stills, which needs them shared with it.
      const headers = new Headers({ 'Access-Control-Allow-Origin': rendererOrigin() });
      if (content && 'data' in content) {
        headers.set('Content-Type', content.type);
        return new Response(request.method === 'HEAD' ? null : content.data, { headers });
      }
      if (content) {
        return await fileResponse(content.file, request, headers);
      }
    } catch {
      // Removed files and closed sessions are normal while browsing.
    }
    return new Response('', { status: NOT_FOUND });
  });
}
