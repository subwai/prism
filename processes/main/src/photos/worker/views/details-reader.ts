import { statPhoto } from '#photos/worker/disk/media-file';
import { filesOwnFailures, type Share } from '#photos/worker/disk/share/share';
import type { Scheduler } from '#photos/worker/scheduler/scheduler';
import type { Catalog, PhotoFile, ReadDetails, UnreadableFile, UnreadPhoto } from '@prism/catalog';
import { readExif } from '@prism/media';

// Photos asked for at a time; the catalog picks the most wanted first.
const BATCH = 64;

/**
 * How one step of reading a photo's details ended: `done` with its value, `failed`, or
 * `notTried` when the library closed first or the step was not needed.
 */
type Attempt<Value> =
  | { kind: 'done'; value: Value }
  | { kind: 'failed'; failure: Failure }
  | { kind: 'notTried' };

const NOT_TRIED = { kind: 'notTried' } as const;

/** The value of an attempt that is done, as a list of one, or an empty list. */
function valuesDone<Value>(attempt: Attempt<Value>): Value[] {
  return attempt.kind === 'done' ? [attempt.value] : [];
}

/** The failure of an attempt that failed, as a list of one, or an empty list. */
function failuresOf(attempt: Attempt<unknown>): Failure[] {
  return attempt.kind === 'failed' ? [attempt.failure] : [];
}

export interface DetailsReaderSources {
  root: string;
  catalog: Catalog;
  signal: AbortSignal;
  /**
   * Orders every read of the disk. Photos' details are read in the background, waiting for the
   * thumbnails and originals the window wants, and at `ahead` priority while a view needs them.
   */
  scheduler: Scheduler;
  /** Whether the library's folder can be reached, which decides whether a failure is the file's own. */
  share: Share;
}

/**
 * Reads photos' details into the catalog, every photo once, so filters and the sort by date
 * taken cover the whole library.
 * - The details come from what the catalog kept of the same file before, such as from a removed
 *   row or another library holding it, and otherwise from the file itself.
 * - Photos on screen go first, then the rest of the open view, then the rest of the library.
 * - It reads gently until a view needs the details.
 * - Photos whose files change are read again, and so are those that could not be read.
 * - What it read, or could not read, stays in the catalog, so a later session carries on where
 *   this one stopped.
 */
export class DetailsReader {
  private urgent = false;
  private woken = Promise.withResolvers<null>();
  private started = false;

  constructor(private readonly sources: DetailsReaderSources) {}

  /** Starts reading, once. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    // Closing wakes an idle run, so it sees the abort and stops.
    this.sources.signal.addEventListener('abort', () => this.wake(), { once: true });
    this.run().catch(() => null);
  }

  /** Wakes the reader, because a folder read or a change may have added photos to read. */
  wake(): void {
    this.woken.resolve(null);
  }

  /** Sets whether a view needs photos' details now, which reads them at full speed. */
  setUrgent(urgent: boolean): void {
    this.urgent = urgent;
    this.wake();
  }

  private async run() {
    const { catalog, signal } = this.sources;
    while (!signal.aborted) {
      this.woken = Promise.withResolvers();
      const photos = await catalog.call('photosToRead', BATCH).catch((): UnreadPhoto[] => []);
      await (photos.length === 0 ? this.woken.promise : this.read(photos));
    }
  }

  /** The priority of reading details now: `ahead` while a view needs them, and gently otherwise. */
  private readonly priority = () => {
    if (this.sources.signal.aborted) {
      return null;
    }
    return this.urgent ? 'ahead' : 'background';
  };

  /**
   * Reads the details of `photos`. Each step runs in the scheduler, and a photo that fails a
   * step is noted with its file as it was then.
   */
  private async read(photos: UnreadPhoto[]) {
    const stats = await this.#statPhotos(photos);
    const files = stats.map((result) => (result.kind === 'done' ? result.value : undefined));
    const toRead = await this.#detailsToRead(files.filter((file) => file !== undefined));
    const reads = await this.#readDetailsOf(photos, files, toRead);
    this.#storeDetails(reads.flatMap((read) => valuesDone(read)));
    await this.#recordFailures([...stats, ...reads].flatMap((step) => failuresOf(step)));
  }

  /** Looks at each photo's file on disk, for its size, times and inode. */
  #statPhotos(photos: UnreadPhoto[]) {
    const { root } = this.sources;
    return Promise.all(
      photos.map((photo) => this.#attempt('stat', photo, photo, () => statPhoto(root, photo.id))),
    );
  }

  /** Reads the details of each photo whose file was found and is in `toRead`. */
  #readDetailsOf(
    photos: UnreadPhoto[],
    files: (PhotoFile | undefined)[],
    toRead: Set<string>,
  ): Promise<Attempt<ReadDetails>[]> {
    return Promise.all(
      photos.map((photo, index) => {
        const file = files[index];
        return file && toRead.has(file.id) ? this.#readDetails(photo, file) : NOT_TRIED;
      }),
    );
  }

  /**
   * Runs `task`, one step of reading `photo`'s details, in the scheduler. If it fails, the
   * failure is returned with `file`, the file as it was then. A step dropped because the library
   * closes counts as not tried.
   */
  async #attempt<Result>(
    step: string,
    photo: UnreadPhoto,
    file: UnreadableFile,
    task: () => Promise<Result>,
  ): Promise<Attempt<Result>> {
    try {
      const value = await this.sources.scheduler.run(
        'details',
        `${step} ${photo.id}`,
        this.priority,
        task,
      );
      return { kind: 'done', value };
    } catch (error) {
      return this.sources.signal.aborted
        ? NOT_TRIED
        : { failure: { error, file, item: photo.item }, kind: 'failed' };
    }
  }

  /**
   * Of `files`, the IDs of those whose details must be read from the file. The catalog reuses the
   * details it kept of the rest, as from a removed row or another library holding the same file.
   */
  async #detailsToRead(files: PhotoFile[]): Promise<Set<string>> {
    const toRead = await this.sources.catalog.call('reuseDetails', files).catch((): string[] => []);
    return new Set(toRead);
  }

  /** Reads the details of `photo` from its `file`. */
  #readDetails(photo: UnreadPhoto, file: PhotoFile) {
    return this.#attempt('exif', photo, file, async (): Promise<ReadDetails> => ({
      ...file,
      exif: await readExif(file.file),
    }));
  }

  #storeDetails(details: ReadDetails[]) {
    if (details.length > 0) {
      this.sources.catalog.write({ details, kind: 'storeDetails' });
    }
  }

  /**
   * Records the photos whose details could not be read. Failures the catalog records as
   * unreadable count as done until their files change. The rest, such as failures because the
   * share went offline, are skipped for this session and tried again in the next.
   */
  async #recordFailures(failed: Failure[]) {
    const { catalog, share } = this.sources;
    const unreadable = new Set(await filesOwnFailures(share, failed));
    if (unreadable.size > 0) {
      catalog.write({ files: [...unreadable].map(({ file }) => file), kind: 'markUnreadable' });
    }
    const skipped = failed.filter((failure) => !unreadable.has(failure));
    if (skipped.length > 0) {
      await catalog
        .call(
          'skip',
          skipped.map(({ item }) => item),
        )
        .catch(() => null);
    }
  }
}

/** A photo whose details could not be read, with its file as it was then, and why. */
interface Failure {
  item: number;
  file: UnreadableFile;
  error: unknown;
}
