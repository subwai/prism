import type { FrameRequest, FrameResponse, PhotoBackend } from '#photos/backend';
import { errorMessage } from '#photos/errors';
import { type PhotoRoot, WorkerClient, type WorkerResponse } from '@prism/shared';
import { MessageChannelMain, type MessagePortMain, nativeImage, utilityProcess } from 'electron';
import path from 'node:path';

type WorkerMessage = WorkerResponse | FrameRequest | { ready: PhotoRoot };

const STARTUP_TIMEOUT_MS = 15_000,
  CLOSED = 'Folder session closed.';

/** One worker owns one folder. Replacing or closing the folder disposes the worker. */
export class PhotoBackendClient {
  private readonly child;
  private readonly client: WorkerClient<PhotoBackend>;
  readonly folder: Promise<PhotoRoot>;
  private stopped = false;

  constructor(root: string, cacheDirectory: string) {
    this.child = utilityProcess.fork(
      path.join(import.meta.dirname, 'photos-worker.js'),
      [root, cacheDirectory],
      {
        serviceName: 'Photo library',
      },
    );
    this.client = new WorkerClient((request) => {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
      this.child.postMessage(request);
    });
    this.folder = new Promise<PhotoRoot>((resolve, reject) => {
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
   * A port the window calls the worker on directly, sparing the main process every scan and
   * thumbnail. It closes when the worker stops.
   */
  async connect(): Promise<MessagePortMain> {
    await this.folder;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ connect: true }, [port1]);
    return port2;
  }

  /** A video still from the system's own thumbnailer: Quick Look, or the Windows shell. */
  private async renderFrame({ id, source, edge }: FrameRequest['frame']): Promise<void> {
    let response: FrameResponse;
    try {
      const image = await nativeImage.createThumbnailFromPath(source, {
        height: edge,
        width: edge,
      });
      if (image.isEmpty()) {
        throw new Error('The video has no still to show.');
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
