import { type PhotoBackendClient, startPhotoBackend } from '#photos/client';
import { randomUUID } from 'node:crypto';

interface Session {
  /** Names the session in its originals' URLs, which outlive nothing but the session. */
  id: string;
  client: PhotoBackendClient;
}

/** The folder each window has open, by its web contents' ID, each served by its own worker. */
export interface PhotoSessions {
  /** Opens `root` for `owner`, closing the folder it had open. */
  open: (owner: number, root: string) => Session;
  get: (owner: number) => Session | undefined;
  /** The session an original's URL names. */
  withId: (id: string) => Session | undefined;
  close: (owner: number) => void;
  closeAll: () => void;
}

export function createPhotoSessions(cacheDirectory: string, indexFile: string): PhotoSessions {
  const sessions = new Map<number, Session>();

  function close(owner: number) {
    sessions.get(owner)?.client.stop();
    sessions.delete(owner);
  }

  return {
    close,
    closeAll() {
      for (const owner of sessions.keys()) {
        close(owner);
      }
    },
    get: (owner) => sessions.get(owner),
    open(owner, root) {
      close(owner);
      const session = {
        client: startPhotoBackend(root, cacheDirectory, indexFile),
        id: randomUUID(),
      };
      sessions.set(owner, session);
      return session;
    },
    withId: (id) => [...sessions.values()].find((session) => session.id === id),
  };
}
