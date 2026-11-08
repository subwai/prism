import type { PhotoEntry, PhotosAPI, ScanBatch, ScanOptions } from '@prism/shared';

/** A folder's listing as a scan read it, for the folder tree. */
export interface ScanState {
  entries: PhotoEntry[];
  errors: ScanBatch['errors'];
  loading: boolean;
  error: string | null;
}

/** Reads a scan to the end. */
export async function readAll(api: PhotosAPI, options: ScanOptions): Promise<ScanState> {
  const scanId = await api.startScan(options);
  const entries: PhotoEntry[] = [];
  const errors: ScanBatch['errors'] = [];
  try {
    for (;;) {
      const batch = await api.nextBatch(scanId);
      entries.push(...batch.entries);
      errors.push(...batch.errors);
      if (batch.done) {
        return { entries, error: null, errors, loading: false };
      }
    }
  } catch (error) {
    return { entries, error: String(error), errors, loading: false };
  }
}
