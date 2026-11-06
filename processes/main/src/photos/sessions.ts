import { PhotoBackendClient } from '#photos/client';
import { randomUUID } from 'node:crypto';

interface Session {
  /** Names the session in its originals' URLs, which outlive nothing but the session. */
  id: string;
  client: PhotoBackendClient;
}

/** The folder each window has open, by its web contents' ID, each served by its own worker. */
export class PhotoSessions {
  private readonly sessions = new Map<number, Session>();

  constructor(
    private readonly cacheDirectory: string,
    private readonly indexFile: string,
  ) {}

  /** Opens `root` for `owner`, closing the folder it had open. */
  open(owner: number, root: string): Session {
    this.close(owner);
    const session = {
      client: new PhotoBackendClient(root, this.cacheDirectory, this.indexFile),
      id: randomUUID(),
    };
    this.sessions.set(owner, session);
    return session;
  }

  get(owner: number): Session | undefined {
    return this.sessions.get(owner);
  }

  /** The session an original's URL names. */
  withId(id: string): Session | undefined {
    return [...this.sessions.values()].find((session) => session.id === id);
  }

  close(owner: number): void {
    this.sessions.get(owner)?.client.stop();
    this.sessions.delete(owner);
  }

  closeAll(): void {
    for (const owner of this.sessions.keys()) {
      this.close(owner);
    }
  }
}
