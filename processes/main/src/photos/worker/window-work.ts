import { ReportedAttention } from '#photos/worker/attention';
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
  /** Tells the window of a thumbnail made, or that could not be. */
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
      viewFiles: (viewId, start, end, limit) => library.viewFiles(viewId, start, end, limit),
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
   * cached, sharing the job under `key` with others asking for it meanwhile, and tells the window
   * what came of it, whoever asked: the window keeps what it hears of the entries it shows.
   * Resolves with that. The file is looked at only once its turn comes, so a share busy with
   * reads keeps nothing else waiting.
   */
  #make(entryId: string, key: string, wants: Want): Promise<ThumbnailResult> {
    return this.sources.library.scheduler.run('thumbnail', key, wants, async (signal) => {
      const result = await this.#generate(entryId, signal).then(ready, (error: unknown) =>
        error instanceof FrameNeededError
          ? { status: 'frame-needed' as const }
          : { message: errorMessage(error), status: 'failed' as const },
      );
      this.sources.tell({ entryId, ...result });
      return result;
    });
  }

  /** Makes the thumbnail of `entryId` unless it is cached; resolves with its key. */
  async #generate(entryId: string, signal: AbortSignal): Promise<string> {
    const { cache, library } = this.sources;
    const source = await library.open(entryId);
    // A still the window stored earlier is cached like any other, so it is found first.
    const made = thumbnailKey(source, mediaKind(source.file) === 'video');
    if (!(await hasThumbnail(cache, made))) {
      await generateThumbnail(cache, source, made, signal, this.#readerFor(source));
    }
    return made;
  }

  /**
   * Makes the thumbnail of a photo or video on show, unless it is cached under the key its listing
   * names, found with no look at the disk, which the window loads itself. It is wanted while the
   * window shows it, and made once on show again if it is dropped first.
   */
  #show(entryId: string): void {
    const { cache, library } = this.sources;
    const make = async () => {
      const listed = await library.listed(entryId);
      const key = listed && listedThumbnailKey(listed, mediaKind(entryId) === 'video');
      if (!key || !(await hasThumbnail(cache, key))) {
        await this.#make(entryId, key ?? `entry ${entryId}`, this.#attention.entry(entryId));
      }
    };
    if (mediaKind(entryId)) {
      make().catch(() => null);
    }
  }

  /**
   * Takes what the window has on show, which orders the scheduler: work for what it no longer
   * shows is dropped, the thumbnails of entries newly on show are made, the tiles on show are
   * read, and thumbnails ahead of the scroll are planned again.
   */
  attend(attention: Attention): void {
    for (const entryId of this.#attention.update(attention)) {
      this.#show(entryId);
    }
    for (const directoryId of attention.tiles) {
      this.#readTile(directoryId);
    }
    this.#replan();
  }

  /**
   * Reads the tile of a folder on show, once a session, while it is on show; the folders its read
   * opens go on in the background once it is not. Asked again while its read waits or runs, it
   * joins that read; a tile not read, as it left the screen first or could not be, is read once on
   * show again.
   */
  #readTile(directoryId: string) {
    const { library } = this.sources;
    if (this.#tilesRead.has(directoryId)) {
      return;
    }
    const wants = this.#attention.tile(directoryId);
    library.scheduler
      .run('tile', directoryId, wants, () =>
        library.readTile(directoryId, () => wants() ?? 'background'),
      )
      .then(() => this.#tilesRead.add(directoryId))
      .catch(() => null);
  }

  /**
   * Finds or makes again the thumbnails of the entries on show among `entryIds`, whose contents
   * changed, once the catalog has them as they are now and the window has forgotten the old ones.
   */
  stale(entryIds: string[]): void {
    for (const entryId of entryIds.filter((id) => this.#attention.shown.has(id))) {
      this.#show(entryId);
    }
  }

  /** Reads tiles again, and finds and plans thumbnails afresh, as after a refresh. */
  forget(): void {
    this.#tilesRead.clear();
    this.#ahead.forget();
    for (const entryId of this.#attention.shown) {
      this.#show(entryId);
    }
  }
}
