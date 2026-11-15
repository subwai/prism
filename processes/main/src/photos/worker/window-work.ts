import { ReportedAttention } from '#photos/worker/attention';
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
import {
  type Attention,
  errorMessage,
  isHeif,
  type ThumbnailNews,
  type ThumbnailResult,
} from '@prism/shared';

/** The answer for a thumbnail cached under `key`, which the `media:` protocol serves. */
export function ready(key: string): ThumbnailResult {
  return { status: 'ready', url: `media://thumbnail/${key}.webp` };
}

export interface WindowWorkSources {
  library: PhotoLibrary;
  cache: ThumbnailCache;
  /** Reads video stills from the system; the window takes the ones it cannot. */
  frame: FrameReader | undefined;
  /** Tells the window the thumbnail of an entry it shows. */
  tell: (news: ThumbnailNews) => void;
}

/**
 * The disk work the window's attention orders: the thumbnails of the entries it shows and those
 * ahead of its scroll, and the tiles of the folders it shows, all in the library's scheduler.
 */
export class WindowWork {
  /** What the window shows, which orders the library's scheduler. */
  readonly #attention = new ReportedAttention();
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
      viewFiles: (viewId, limit) => library.viewFiles(viewId, limit),
    });
    // A view on show that changes, as its folders are read, has its thumbnails planned again.
    library.views.onView(({ viewId }) => {
      if (this.#attention.views.some((rows) => rows.viewId === viewId)) {
        this.#ahead.changed(viewId);
        this.sources.library.scheduler.reconsider();
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
   * Tells the window the thumbnail of `entryId`, which it shows: cached under the key its listing
   * names, found with no look at the disk, or else made in its turn, while the window shows it.
   * One the window stops showing first is dropped, and told of once it is on show again.
   */
  #tellThumbnail(entryId: string): void {
    this.#thumbnail(entryId)
      .then((result) => result && this.sources.tell({ entryId, ...result }))
      .catch(() => null);
  }

  async #thumbnail(entryId: string): Promise<ThumbnailResult | null> {
    const { cache, library } = this.sources;
    try {
      const listed = await library.listed(entryId);
      const key = listed && listedThumbnailKey(listed, mediaKind(entryId) === 'video');
      if (key && (await hasThumbnail(cache, key))) {
        return ready(key);
      }
      const wants = this.#attention.entry(entryId);
      return ready(await this.#make(entryId, key ?? `entry ${entryId}`, wants));
    } catch (error) {
      if (error instanceof DroppedError) {
        return null;
      }
      if (error instanceof FrameNeededError) {
        return { status: 'frame-needed' };
      }
      return { message: errorMessage(error), status: 'failed' };
    }
  }

  /**
   * Takes what the window has on show, which orders the scheduler: work for what it no longer
   * shows is dropped, the thumbnails of entries newly on show are told of, the tiles on show are
   * read, and thumbnails ahead of the scroll are planned again.
   */
  attend(attention: Attention): void {
    for (const entryId of this.#attention.update(attention)) {
      this.#tellThumbnail(entryId);
    }
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

  /**
   * Finds or makes again the thumbnails of the entries on show among `entryIds`, whose contents
   * changed, once the catalog has them as they are now and the window has forgotten the old ones.
   */
  stale(entryIds: string[]): void {
    for (const entryId of entryIds.filter((id) => this.#attention.shown.has(id))) {
      this.#tellThumbnail(entryId);
    }
  }

  /** Reads tiles again, and finds and plans thumbnails afresh, as after a refresh. */
  forget(): void {
    this.#tilesRead.clear();
    this.#ahead.forget();
    for (const entryId of this.#attention.shown) {
      this.#tellThumbnail(entryId);
    }
  }
}
