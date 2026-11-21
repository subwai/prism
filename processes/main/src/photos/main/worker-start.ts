import type { FrameRequest, PhotoRoot, WorkerResponse } from '@prism/shared';

/** The folder as the worker reads it; the main process names the session. */
export type OpenedRoot = Omit<PhotoRoot, 'session'>;

/**
 * What the worker tells the main process: as it starts, that it is upgrading the catalog, then
 * that its folder is ready; after, the stills it asks for and its answers to calls.
 */
export type WorkerMessage =
  | { upgrading: true }
  | { ready: OpenedRoot }
  | FrameRequest
  | WorkerResponse;

/** What the main process tells the worker as a Prism window gains or loses focus. */
export interface WorkerFocus {
  focused: boolean;
}

/** The worker process, as far as watching it start goes. */
interface StartingWorker {
  on: (event: 'message', listener: (message: WorkerMessage) => void) => unknown;
  once: (event: 'exit', listener: () => void) => unknown;
}

const STARTUP_TIMEOUT_MS = 15_000;

/**
 * The folder `worker` opens, once it is ready. A worker that says nothing for
 * `STARTUP_TIMEOUT_MS` has hung and fails. One that says it is upgrading the catalog is
 * working, and may take minutes on a large one, so it is waited for, and `upgrading` hears.
 */
export function workerStart(worker: StartingWorker, upgrading: () => void): Promise<OpenedRoot> {
  return new Promise<OpenedRoot>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Photo backend did not start.'));
    }, STARTUP_TIMEOUT_MS);
    worker.on('message', (message) => {
      if ('upgrading' in message) {
        clearTimeout(timer);
        upgrading();
      } else if ('ready' in message) {
        clearTimeout(timer);
        resolve(message.ready);
      }
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Photo backend stopped. Select the folder again.'));
    });
  });
}
