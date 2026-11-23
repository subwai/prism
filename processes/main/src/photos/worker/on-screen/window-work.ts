import { ShareOfflineError } from '#photos/worker/disk/share/share-offline-error';
import type { PhotoLibrary } from '#photos/worker/library/library';
import { readyThumbnail } from '#photos/worker/on-screen/cached-thumbnails';
import { LatestScreenContents } from '#photos/worker/on-screen/screen-contents';
import { askWindowForStill, FrameNeededError, rejectIcons } from '#photos/worker/on-screen/stills';
import { ThumbnailsAhead } from '#photos/worker/on-screen/thumbnails-ahead';
import type { CurrentPriority } from '#photos/worker/scheduler/scheduler';
import {
  type DecodeTurn,
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
  debug,
  errorMessage,
  isHeif,
  type ScreenContents,
  type ThumbnailResult,
  type ThumbnailUpdate,
} from '@prism/shared';

const log = debug('worker:thumbnails');

export interface WindowWorkSources {
  library: PhotoLibrary;
  cache: ThumbnailCache;
  /** Reads video stills from the system; the window takes the ones it cannot. */
  frame: FrameReader | undefined;
  /** Sends the window a thumbnail that was made, or that could not be made. */
  sendThumbnail: (update: ThumbnailUpdate) => void;
}

/**
 * The disk work for what the window has on screen: the thumbnails of the entries it shows and
 * of those ahead of its scroll, and the tiles of the folders it shows. All of it runs in the
 * library's scheduler, ordered by what is on screen.
 */
export class WindowWork {
  /** What the window has on screen, which sets the priority of the work below. */
  readonly #screen = new LatestScreenContents();
  readonly #ahead: ThumbnailsAhead;
  /** Folders whose tiles were read this session, which are kept current after that. */
  readonly #tilesRead = new Set<string>();

  constructor(private readonly sources: WindowWorkSources) {
    const { library } = sources;
    this.#ahead = new ThumbnailsAhead({
      makeThumbnail: (entryId, key, priority) => this.#makeThumbnail(entryId, key, priority),
      root: library.root,
      screen: this.#screen,
      signal: library.signal,
      viewFiles: (viewId, start, end, limit) => library.viewFiles(viewId, start, end, limit),
    });
    // When a view on screen changes, as its folders are read, its thumbnails are planned again.
    library.views.onNewVersion(({ viewId }) => {
      if (this.#screen.views.some((rows) => rows.viewId === viewId)) {
        this.#ahead.viewChanged(viewId);
        this.sources.library.scheduler.reschedule();
      }
    });
  }

  #planThumbnailsAhead() {
    this.#ahead.plan();
    this.sources.library.scheduler.reschedule();
  }

  /**
   * Where the image for a thumbnail comes from:
   * - a video's still from the system if it can render one, and from the window otherwise;
   * - a HEIF photo's from the system's conversion, the same one the viewer shows;
   * - every other photo is decoded by sharp itself, so there is no reader.
   */
  #readerFor(source: ThumbnailSource): FrameReader | undefined {
    const { frame } = this.sources;
    if (mediaKind(source.file) !== 'video') {
      return isHeif(source.file) ? heifThumbnail : undefined;
    }
    return frame && systemRendersVideo(source.file) ? rejectIcons(frame) : askWindowForStill;
  }

  /**
   * Makes the thumbnail of the photo or video `entryId` when its turn comes, and resolves with
   * the result.
   * - `key` is the thumbnail's key as named from the catalog's listing, without looking at the
   *   disk. If it is cached under that key, the window loads it itself and nothing is made.
   * - Otherwise the file is looked at only when its turn comes, so a share busy with reads keeps
   *   nothing else waiting. It may turn out to be cached then.
   * - Others asking for the same thumbnail meanwhile share the job. The window is sent the result
   *   whoever asked, because it keeps the results for the entries it shows.
   */
  async #makeThumbnail(
    entryId: string,
    key: string | null,
    priority: CurrentPriority,
  ): Promise<ThumbnailResult> {
    const { cache, library } = this.sources;
    if (key && (await hasThumbnail(cache, key).catch(() => false))) {
      return readyThumbnail(key);
    }
    log('%s waits for its turn', entryId);
    const job = key ?? `entry ${entryId}`;
    return library.scheduler.run('thumbnail', job, priority, async (signal, jobPriority) => {
      log('%s is being made', entryId);
      // A photo already read is decoded even once nothing wants it, so the read is not wasted.
      // It then counts as work ahead of the scroll, which leaves a decode free for what the
      // window shows.
      const turn: DecodeTurn = (decode) =>
        library.scheduler.run('decode', job, () => jobPriority() ?? 'ahead', decode);
      const result = await this.#generate(entryId, signal, turn).then(
        readyThumbnail,
        async (error: unknown) => {
          // Made once the share is back, rather than reported as failed.
          if (await library.share.failedOffline(error)) {
            throw new ShareOfflineError();
          }
          return error instanceof FrameNeededError
            ? { status: 'frame-needed' as const }
            : { message: errorMessage(error), status: 'failed' as const };
        },
      );
      log('%s: %s', entryId, result.status);
      this.sources.sendThumbnail({ entryId, ...result });
      return result;
    });
  }

  /**
   * Makes the thumbnail of `entryId` unless it is cached, decoding it in `turn`; resolves with its
   * key.
   */
  async #generate(entryId: string, signal: AbortSignal, turn: DecodeTurn): Promise<string> {
    const { cache, library } = this.sources;
    const source = await library.openMediaFile(entryId);
    // A still the window stored earlier is cached like any other, so it is found first.
    const made = thumbnailKey(source, mediaKind(source.file) === 'video');
    if (!(await hasThumbnail(cache, made))) {
      await generateThumbnail(cache, {
        frame: this.#readerFor(source),
        key: made,
        signal,
        source,
        turn,
      });
    }
    return made;
  }

  /**
   * Makes the thumbnail of a photo or video on screen, unless it is cached. Its priority is
   * visible while the window shows it. If it is dropped first, it is made when it is on screen
   * again.
   */
  #makeShownThumbnail(entryId: string): void {
    const { library } = this.sources;
    const make = async () => {
      const listed = await library.listedFile(entryId);
      const key = listed ? listedThumbnailKey(listed, mediaKind(entryId) === 'video') : null;
      await this.#makeThumbnail(entryId, key, this.#screen.thumbnailPriority(entryId));
    };
    if (mediaKind(entryId)) {
      make().catch(() => null);
    }
  }

  /**
   * Takes what the window has on screen now. Work for what it no longer shows is dropped by the
   * scheduler, the thumbnails of entries newly on screen are made, the tiles on screen are read,
   * and thumbnails ahead of the scroll are planned again.
   */
  updateScreen(contents: ScreenContents): void {
    for (const entryId of this.#screen.update(contents)) {
      this.#makeShownThumbnail(entryId);
    }
    for (const directoryId of contents.foldersToRead) {
      this.#readTile(directoryId);
    }
    this.#planThumbnailsAhead();
  }

  /**
   * Reads the tile of a folder on screen, once a session, at visible priority while it is on
   * screen. The folders the read opens carry on in the background once it is not.
   * - Asked again while its read waits or runs, it joins that read.
   * - A tile that was not read, because it left the screen first or the read failed, is read
   *   when it is on screen again.
   */
  #readTile(directoryId: string) {
    const { library } = this.sources;
    if (this.#tilesRead.has(directoryId)) {
      return;
    }
    const priority = this.#screen.tilePriority(directoryId);
    library.scheduler
      .run('tile', directoryId, priority, () =>
        library.readTile(directoryId, () => priority() ?? 'background'),
      )
      .then(() => this.#tilesRead.add(directoryId))
      .catch(() => null);
  }

  /**
   * Finds or makes again the thumbnails of the entries on screen among `entryIds`, whose
   * contents changed. It is called once the catalog has them as they are now and the window has
   * dropped the old thumbnails.
   */
  remakeStaleThumbnails(entryIds: string[]): void {
    for (const entryId of entryIds.filter((id) => this.#screen.shown.has(id))) {
      this.#makeShownThumbnail(entryId);
    }
  }

  /** Reads tiles again, and finds and plans thumbnails afresh, as after a refresh. */
  startOver(): void {
    this.#tilesRead.clear();
    this.#ahead.startOver();
    for (const entryId of this.#screen.shown) {
      this.#makeShownThumbnail(entryId);
    }
  }
}
