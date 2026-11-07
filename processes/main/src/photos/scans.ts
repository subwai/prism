import type { ScanItem } from '#photos/read-folder';
import { requireString } from '#photos/validate';
import type { ScanBatch, ScanOptions } from '@prism/shared';
import { randomUUID } from 'node:crypto';

const BATCH_SIZE = 128,
  // A batch keeps filling for this long while entries are at hand, as those of folders listed
  // before are, so a large library listed from memory takes a few round trips rather than
  // thousands.
  BATCH_MS = 10,
  MAX_BATCH_SIZE = 16_384,
  MAX_SCANS = 4;

interface Scan {
  controller: AbortController;
  iterator: AsyncGenerator<ScanItem, void>;
  busy: boolean;
}

/**
 * The scans a window has open, each walking the folder as `walk` does and pulled a batch at a
 * time, until it ends, is cancelled, or `signal` aborts.
 */
export class Scans {
  private readonly scans = new Map<string, Scan>();

  constructor(
    private readonly walk: (
      options: ScanOptions,
      signal: AbortSignal,
    ) => AsyncGenerator<ScanItem, void>,
    private readonly signal: AbortSignal,
  ) {}

  /** Starts a scan with `options`, which have been checked. */
  start(options: ScanOptions): string {
    if (this.scans.size >= MAX_SCANS) {
      throw new Error('Too many open scans. Cancel an existing scan first.');
    }
    const scanId = randomUUID(),
      controller = new AbortController();
    this.scans.set(scanId, {
      busy: false,
      controller,
      iterator: this.walk(options, AbortSignal.any([controller.signal, this.signal])),
    });
    return scanId;
  }

  async next(scanId: string): Promise<ScanBatch> {
    requireString(scanId);
    const scan = this.scans.get(scanId);
    if (!scan) {
      throw new Error('Scan is closed or does not exist.');
    }
    if (scan.busy) {
      throw new Error('Only one batch may be requested at a time for a scan.');
    }
    scan.busy = true;
    const batch: ScanBatch = { done: false, entries: [], errors: [] };
    const started = performance.now();
    const more = (size: number) =>
      size < BATCH_SIZE || (size < MAX_BATCH_SIZE && performance.now() - started < BATCH_MS);
    try {
      while (more(batch.entries.length + batch.errors.length)) {
        const item = await scan.iterator.next();
        if (item.done) {
          batch.done = true;
          this.scans.delete(scanId);
          break;
        }
        if ('entry' in item.value) {
          batch.entries.push(item.value.entry);
        } else {
          batch.errors.push(item.value.error);
        }
      }
      return batch;
    } catch (error) {
      await this.cancel(scanId);
      throw error;
    } finally {
      scan.busy = false;
    }
  }

  async cancel(scanId: string): Promise<void> {
    requireString(scanId);
    const scan = this.scans.get(scanId);
    if (scan) {
      scan.controller.abort();
      this.scans.delete(scanId);
      await scan.iterator.return();
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.scans.keys()].map((scanId) => this.cancel(scanId)));
  }
}
