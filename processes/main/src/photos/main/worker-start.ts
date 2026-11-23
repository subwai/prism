import type { OpenedRoot, WorkerMessage } from '#photos/messages';

/** The worker process, as far as watching it start goes. */
interface StartingWorker {
  on: (event: 'message', listener: (message: WorkerMessage) => void) => unknown;
  once: (event: 'exit', listener: () => void) => unknown;
}

const STARTUP_TIMEOUT_MS = 15_000;

/**
 * The folder `worker` opens, once it is ready. A worker that says nothing for
 * `STARTUP_TIMEOUT_MS` has hung and fails. One that says it is upgrading the catalog is
 * working, and may take minutes on a large one, so it is waited for, and `upgrading` is called.
 */
export function waitForWorkerStart(
  worker: StartingWorker,
  upgrading: () => void,
): Promise<OpenedRoot> {
  return new Promise<OpenedRoot>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Photo backend did not start.'));
    }, STARTUP_TIMEOUT_MS);
    worker.on('message', (message) => {
      switch (message.kind) {
        case 'upgrading': {
          clearTimeout(timer);
          upgrading();
          break;
        }
        case 'ready': {
          clearTimeout(timer);
          resolve(message.folder);
          break;
        }
        default: {
          // Stills and answers are the client's to handle.
          break;
        }
      }
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Photo backend stopped. Select the folder again.'));
    });
  });
}
