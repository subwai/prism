import { errorMessage } from '#photos/errors';
import {
  createWorkerClient,
  type FrameRequest,
  type FrameResponse,
  type PhotoBackend,
  type PhotoRoot,
  type WorkerResponse,
} from '@prism/shared';
import { MessageChannelMain, type MessagePortMain, nativeImage, utilityProcess } from 'electron';
import path from 'node:path';

type WorkerMessage = WorkerResponse | FrameRequest | { ready: PhotoRoot };

const STARTUP_TIMEOUT_MS = 15_000,
  CLOSED = 'Folder session closed.';

/**
 * A still of a video or HEIF photo from the system's own thumbnailer: Quick Look, or the
 * Windows shell.
 */
async function renderFrame({
  id,
  source,
  width,
  height,
}: FrameRequest['frame']): Promise<FrameResponse> {
  try {
    const image = await nativeImage.createThumbnailFromPath(source, { height, width });
    if (image.isEmpty()) {
      throw new Error('The file has no still to show.');
    }
    return { frame: { id, image: image.toPNG() } };
  } catch (error) {
    return { frame: { error: errorMessage(error), id } };
  }
}

/** One worker owns one folder. Replacing or closing the folder disposes the worker. */
export interface PhotoBackendClient {
  readonly folder: Promise<PhotoRoot>;
  call: <Method extends keyof PhotoBackend & string>(
    method: Method,
    ...args: Parameters<PhotoBackend[Method]>
  ) => Promise<Awaited<ReturnType<PhotoBackend[Method]>>>;
  /**
   * A port the window calls the worker on directly, sparing the main process every listing and
   * thumbnail. It closes when the worker stops.
   */
  connect: () => Promise<MessagePortMain>;
  stop: () => void;
}

export function startPhotoBackend(
  root: string,
  cacheDirectory: string,
  indexFile: string,
): PhotoBackendClient {
  const child = utilityProcess.fork(
    path.join(import.meta.dirname, 'photos-worker.js'),
    [root, cacheDirectory, indexFile],
    {
      serviceName: 'Photo library',
    },
  );
  const client = createWorkerClient<PhotoBackend>((request) => {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
    child.postMessage(request);
  });
  let stopped = false;

  function stop() {
    if (!stopped) {
      stopped = true;
      child.kill();
      client.close(CLOSED);
    }
  }

  const folder = new Promise<PhotoRoot>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Photo backend did not start.'));
      stop();
    }, STARTUP_TIMEOUT_MS);
    child.on('message', (message: WorkerMessage) => {
      if ('frame' in message) {
        renderFrame(message.frame)
          .then((response) => {
            if (!stopped) {
              // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
              child.postMessage(response);
            }
          })
          .catch(() => null);
      } else if ('ready' in message) {
        clearTimeout(timer);
        resolve(message.ready);
      } else {
        client.receive(message);
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Photo backend stopped. Select the folder again.'));
      stop();
    });
  });

  async function call<Method extends keyof PhotoBackend & string>(
    method: Method,
    ...args: Parameters<PhotoBackend[Method]>
  ): Promise<Awaited<ReturnType<PhotoBackend[Method]>>> {
    await folder;
    return client.call(method, ...args);
  }

  return {
    call,
    async connect() {
      await folder;
      const { port1, port2 } = new MessageChannelMain();
      child.postMessage({ connect: true }, [port1]);
      return port2;
    },
    folder,
    stop,
  };
}
