import { fileResponse } from '#photos/file-response';
import type { PhotoSessions } from '#photos/sessions';
import { thumbnailDirectory } from '#photos/thumbnail-directory';
import { rendererOrigin } from '#renderer-url';
import { protocol } from 'electron';
import path from 'node:path';

const METHOD_NOT_ALLOWED = 405,
  NOT_FOUND = 404;

/** The URL that shows `entryId` of `session`, valid while the session is open. */
export function originalURL(sessionId: string, entryId: string): string {
  return `media://original/${sessionId}/${encodeURIComponent(entryId)}`;
}

/** The file a `media:` URL names: a cached thumbnail, or an original in an open folder. */
async function fileFor(url: URL, sessions: PhotoSessions): Promise<string | null> {
  if (url.host === 'thumbnail' && /^\/[a-f\d]{64}\.webp$/u.test(url.pathname)) {
    return path.join(thumbnailDirectory(), url.pathname.slice(1));
  }
  if (url.host === 'original') {
    const [, sessionId = '', entryId] = url.pathname.split('/');
    const session = sessions.withId(sessionId);
    if (session && entryId) {
      return await session.client.call('original', decodeURIComponent(entryId));
    }
  }
  return null;
}

/** Serves thumbnails and originals to the window, with byte ranges for videos. */
export function registerMediaProtocol(sessions: PhotoSessions): void {
  protocol.handle('media', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('', { status: METHOD_NOT_ALLOWED });
    }
    try {
      const file = await fileFor(new URL(request.url), sessions);
      if (file) {
        // The window draws videos to take their stills, which needs them shared with it.
        const headers = new Headers({ 'Access-Control-Allow-Origin': rendererOrigin() });
        return await fileResponse(file, request, headers);
      }
    } catch {
      // Removed files and closed sessions are normal while browsing.
    }
    return new Response('', { status: NOT_FOUND });
  });
}
