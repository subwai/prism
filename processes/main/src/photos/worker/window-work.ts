import { WindowAttention } from '#photos/worker/attention';
import { DroppedError } from '#photos/worker/dropped-error';
import type { PhotoLibrary } from '#photos/worker/library';
import type { Want } from '#photos/worker/scheduler';
import { FrameNeededError, fromWindow, stillsOnly } from '#photos/worker/stills';
import { ThumbnailsAhead } from '#photos/worker/thumbnails-ahead';
import {
  type FrameReader,
  generateThumbnail,
  hasThumbnail,
  heifThumbnail,
  listedThumbnailKey,
  mediaKind,
  systemRendersVideo,
  type ThumbnailCache,
  thumbnailKey,
  type ThumbnailSource,
} from '@prism/media';
import { type Attention, errorMessage, isHeif, type ThumbnailResult } from '@prism/shared';

/** The answer for a thumbnail cached under `key`, which the `media:` protocol serves. */
export function ready(key: string): ThumbnailResult {
  return { status: 'ready', url: `media://thumbnail/${key}.webp` };
}

export interface WindowWorkSources {
  library: PhotoLibrary;
  cache: ThumbnailCache;
  /** Reads video stills from the system; the window takes the ones it cannot. */
  frame: FrameReader | undefined;
}

/**
 * The disk work the window's attention orders: the thumbnails it asks for and those ahead of its
 * scroll, and the tiles of the folders it shows, all in the library's scheduler.
 */
export class WindowWork {
  /** What the window shows, which orders the library's scheduler. */
  readonly #attention = new WindowAttention();
  readonly #ahead: ThumbnailsAhead;
  /** Folders whose tiles were read this session, which are kept current after that. */
  readonly #tilesRead = new Set<string>();

  constructor(private readonly sources: WindowWorkSources) {
    const { cache, library } = sources;
    this.#ahead = new ThumbnailsAhead({
      attention: this.#attention,
      cache,
      make: (entryId, key, wants) => this.#make(entryId, key, wants),
      root: library.root,
      signal: library.signal,
      viewFiles: (viewId) => library.viewFiles(viewId),
    });
    // A view on show that changes, as its folders are read, has its thumbnails planned again.
    library.views.onView(({ viewId }) => {
      if (this.#attention.views.some((rows) => rows.viewId === viewId)) {
        this.#replan();
      }
    });
  }

  #replan() {
    this.#ahead.replan();
    this.sources.library.scheduler.reconsider();
  }

  /**
   * The still of a video comes from the system if it can render one, or else the window. A HEIF
   * photo's comes from the system's conversion the viewer shows, while sharp decodes every other
   * photo itself.
   */
  #readerFor(source: ThumbnailSource): FrameReader | undefined {
    const { frame } = this.sources;
    if (mediaKind(source.file) !== 'video') {
      return isHeif(source.file) ? heifThumbnail : undefined;
    }
    return frame && systemRendersVideo(source.file) ? stillsOnly(frame) : fromWindow;
  }

  /**
   * Makes the thumbnail of the photo or video `entryId` in its turn, unless it turns out to be
   * cached, sharing the job under `key` with others asking for it meanwhile; resolves with the
   * key it is cached under. The file is looked at only once its turn comes, so a share busy with
   * reads keeps nothing else waiting.
   */
  #make(entryId: string, key: string, wants: Want): Promise<string> {
    const { cache, library } = this.sources;
    return library.scheduler.run('thumbnail', key, wants, async (signal) => {
      const source = await library.open(entryId);
      // A still the window stored earlier is cached like any other, so it is found first.
      const made = thumbnailKey(source, mediaKind(source.file) === 'video');
      if (!(await hasThumbnail(cache, made))) {
        await generateThumbnail(cache, source, made, signal, this.#readerFor(source));
      }
      return made;
    });
  }

  /**
   * The thumbnail of `entryId`, made in its turn unless it is cached: on show, as the window asks
   * for what it shows, until the window says it no longer shows it, and then dropped if it has not
   * started. One cached under the key its listing names is found with no look at the disk.
   */
  async request(entryId: string): Promise<ThumbnailResult> {
    const { cache, library } = this.sources;
    const wants = this.#attention.asked(entryId);
    try {
      const listed = await library.listed(entryId);
      const key = listed && listedThumbnailKey(listed, mediaKind(entryId) === 'video');
      if (key && (await hasThumbnail(cache, key))) {
        return ready(key);
      }
      return ready(await this.#make(entryId, key ?? `entry ${entryId}`, wants));
    } catch (error) {
      if (error instanceof FrameNeededError) {
        return { status: 'frame-needed' };
      }
      if (error instanceof DroppedError) {
        return { status: 'dropped' };
      }
      return { message: errorMessage(error), status: 'failed' };
    }
  }

  /**
   * Takes what the window has on show, which orders the scheduler: work it asked for that it no
   * longer shows is dropped, the tiles on show are read, and thumbnails ahead of the scroll are
   * planned again.
   */
  attend(attention: Attention): void {
    this.#attention.update(attention);
    for (const directoryId of attention.tiles) {
      this.#readTile(directoryId);
    }
    this.#replan();
  }

  /**
   * Reads the tile of a folder on show, once a session, while it is on show; the folders its read
   * opens go on in the background once it is not.
   */
  #readTile(directoryId: string) {
    const { library } = this.sources;
    if (this.#tilesRead.has(directoryId)) {
      return;
    }
    this.#tilesRead.add(directoryId);
    const wants = this.#attention.tile(directoryId);
    library.scheduler
      .run('tile', directoryId, wants, () =>
        library.readTile(directoryId, () => wants() ?? 'background'),
      )
      // A tile not read, as it left the screen first or could not be, is read once on show again.
      .catch(() => this.#tilesRead.delete(directoryId));
  }

  /** Reads tiles again, and plans thumbnails afresh, as after a refresh. */
  forget(): void {
    this.#tilesRead.clear();
    this.#ahead.forget();
  }
}
