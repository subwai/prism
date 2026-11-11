import type { CatalogFiles } from '@prism/catalog';
import {
  debug,
  errorMessage,
  type FrameRequest,
  type FrameResponse,
  type PhotoBackend,
  type PhotoRoot,
  WorkerClient,
  type WorkerResponse,
} from '@prism/shared';
import { MessageChannelMain, type MessagePortMain, nativeImage, utilityProcess } from 'electron';
import path from 'node:path';

/** The folder as the worker reads it; the main process names the session. */
type OpenedRoot = Omit<PhotoRoot, 'session'>;

type WorkerMessage = WorkerResponse | FrameRequest | { ready: OpenedRoot };

const STARTUP_TIMEOUT_MS = 15_000,
  CLOSED = 'Folder session closed.',
  calls = debug('main:calls');

/** One worker owns one folder. Replacing or closing the folder disposes the worker. */
export class PhotoBackendClient {
  private readonly child;
  private readonly client: WorkerClient<PhotoBackend>;
  readonly folder: Promise<OpenedRoot>;
  private stopped = false;

  constructor(root: string, cacheDirectory: string, files: CatalogFiles) {
    this.child = utilityProcess.fork(
      path.join(import.meta.dirname, 'photos-worker.js'),
      [root, cacheDirectory, files.index, files.ratings],
      {
        serviceName: 'Photo library',
      },
    );
    this.client = new WorkerClient((request) => {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
      this.child.postMessage(request);
    }, calls);
    this.folder = new Promise<OpenedRoot>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Photo backend did not start.'));
        this.stop();
      }, STARTUP_TIMEOUT_MS);
      this.child.on('message', (message: WorkerMessage) => {
        if ('frame' in message) {
          this.renderFrame(message.frame);
        } else if ('ready' in message) {
          clearTimeout(timer);
          resolve(message.ready);
        } else {
          this.client.receive(message);
        }
      });
      this.child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Photo backend stopped. Select the folder again.'));
        this.stop();
      });
    });
  }

  async call<Method extends keyof PhotoBackend>(
    method: Method,
    ...args: Parameters<PhotoBackend[Method]>
  ): Promise<Awaited<ReturnType<PhotoBackend[Method]>>> {
    await this.folder;
    return this.client.call(method, ...args);
  }

  /**
   * A port the window calls the worker on directly, sparing the main process every listing and
   * thumbnail. It closes when the worker stops.
   */
  async connect(): Promise<MessagePortMain> {
    await this.folder;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ connect: true }, [port1]);
    return port2;
  }

  /**
   * A still of a video from the system's own thumbnailer: Quick Look, or the Windows shell.
   */
  private async renderFrame({ id, source, width, height }: FrameRequest['frame']): Promise<void> {
    let response: FrameResponse;
    try {
      const image = await nativeImage.createThumbnailFromPath(source, { height, width });
      if (image.isEmpty()) {
        throw new Error('The file has no still to show.');
      }
      response = { frame: { id, image: image.toPNG() } };
    } catch (error) {
      response = { frame: { error: errorMessage(error), id } };
    }
    if (!this.stopped) {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
      this.child.postMessage(response);
    }
  }

  stop(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.child.kill();
      this.client.close(CLOSED);
    }
  }
}
