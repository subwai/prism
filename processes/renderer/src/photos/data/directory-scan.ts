import type { PhotoEntry, PhotosAPI, ScanBatch, ScanOptions } from '@app/shared';

export interface ScanState {
  entries: PhotoEntry[];
  errors: ScanBatch['errors'];
  loading: boolean;
  error: string | null;
}

export interface DirectoryScan {
  key: string;
  next: (signal: AbortSignal) => Promise<ScanState>;
  close: () => void;
}

/** The active route owns this reader and closes it when it leaves. */
export async function openScan(
  api: PhotosAPI,
  options: ScanOptions,
  signal: AbortSignal
): Promise<DirectoryScan> {
  signal.throwIfAborted();
  const scanId = await api.startScan(options);
  let closed = false;
  let state: ScanState = { entries: [], error: null, errors: [], loading: true };
  function close() {
    if (closed) {
      return;
    }
    closed = true;
    api.cancelScan(scanId).catch(() => {
      /* The session may already be closed. */
    });
  }
  if (signal.aborted) {
    close();
    signal.throwIfAborted();
  }

  async function next(requestSignal: AbortSignal) {
    if (!state.loading) {
      return state;
    }
    requestSignal.addEventListener('abort', close, { once: true });
    try {
      requestSignal.throwIfAborted();
      const entries = [...state.entries],
        errors = [...state.errors];
      let done = false;
      const deadline = performance.now() + 12;
      do {
        if (closed) {
          throw new DOMException('Scan cancelled', 'AbortError');
        }
        const batch = await api.nextBatch(scanId);
        requestSignal.throwIfAborted();
        entries.push(...batch.entries);
        errors.push(...batch.errors);
        ({ done } = batch);
      } while (!done && state.entries.length > 0 && performance.now() < deadline);
      state = { entries, error: null, errors, loading: !done };
      if (done) {
        close();
      }
    } catch (error) {
      close();
      if (requestSignal.aborted) {
        throw error;
      }
      state = { ...state, error: String(error), loading: false };
    } finally {
      requestSignal.removeEventListener('abort', close);
    }
    return state;
  }
  return { close, key: crypto.randomUUID(), next };
}
