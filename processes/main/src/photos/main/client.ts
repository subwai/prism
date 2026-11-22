import {
  type OpenedRoot,
  type WorkerFocus,
  type WorkerMessage,
  workerStart,
} from '#photos/main/worker-start';
import type { CatalogFiles } from '@prism/catalog';
import { THREAD_POOL_SIZE } from '@prism/media';
import {
  debug,
  errorMessage,
  type FrameRequest,
  type FrameResponse,
  type PhotoBackend,
  WorkerClient,
} from '@prism/shared';
import { MessageChannelMain, type MessagePortMain, nativeImage, utilityProcess } from 'electron';
import path from 'node:path';

const CLOSED = 'Folder session closed.';
const calls = debug('main:calls');

/**
 * One worker owns one folder. Replacing or closing the folder disposes the worker. `upgrading`
 * hears if the worker upgrades the catalog before it opens the folder.
 */
export class PhotoBackendClient {
  private readonly child;
  private readonly client: WorkerClient<PhotoBackend>;
  readonly folder: Promise<OpenedRoot>;
  private stopped = false;

  constructor(root: string, cacheDirectory: string, files: CatalogFiles, upgrading: () => void) {
    this.child = utilityProcess.fork(
      path.join(import.meta.dirname, 'photos-worker.js'),
      [root, cacheDirectory, files.index, files.ratings],
      {
        env: { ...process.env, UV_THREADPOOL_SIZE: String(THREAD_POOL_SIZE) },
        serviceName: 'Photo library',
      },
    );
    this.client = new WorkerClient((request) => {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
      this.child.postMessage(request);
    }, calls);
    this.child.on('message', (message: WorkerMessage) => {
      if ('frame' in message) {
        this.renderFrame(message.frame);
      } else if ('id' in message) {
        this.client.receive(message);
      }
    });
    this.child.once('exit', () => this.stop());
    this.folder = workerStart(this.child, upgrading);
    this.folder.catch(() => this.stop());
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
   * Tells the worker whether a Prism window is focused, which reads photos' details faster. It
   * is told once its folder is open, as it hears nothing before.
   */
  focus(focused: boolean): void {
    this.folder.then(
      () => {
        if (!this.stopped) {
          // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
          this.child.postMessage({ focused } satisfies WorkerFocus);
        }
      },
      () => null,
    );
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
      response = { frame: { id, image: image.toPNG(), kind: 'image' } };
    } catch (error) {
      response = { frame: { error: errorMessage(error), id, kind: 'error' } };
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
