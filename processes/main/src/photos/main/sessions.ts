import { PhotoBackendClient } from '#photos/main/client';
import { photoIndexFile, ratingsFile } from '#photos/main/index-file';
import { thumbnailDirectory } from '#photos/main/thumbnail-directory';
import { randomUUID } from 'node:crypto';

interface Session {
  /** Names the session in its originals' URLs, which outlive nothing but the session. */
  id: string;
  /** The folder open, as the user picked it. */
  root: string;
  client: PhotoBackendClient;
}

/** The folder each window has open, by its web contents' ID, each served by its own worker. */
const sessions = new Map<number, Session>();

export function closeSession(owner: number): void {
  sessions.get(owner)?.client.stop();
  sessions.delete(owner);
}

/** Opens `root` for `owner`, closing the folder it had open. */
export function openSession(owner: number, root: string): Session {
  closeSession(owner);
  const session = {
    client: new PhotoBackendClient(root, thumbnailDirectory(), {
      index: photoIndexFile(),
      ratings: ratingsFile(),
    }),
    id: randomUUID(),
    root,
  };
  sessions.set(owner, session);
  return session;
}

export function sessionOf(owner: number): Session | undefined {
  return sessions.get(owner);
}

/** The session an original's URL names. */
export function sessionWithId(id: string): Session | undefined {
  return [...sessions.values()].find((session) => session.id === id);
}

export function closeAllSessions(): void {
  for (const owner of sessions.keys()) {
    closeSession(owner);
  }
}
