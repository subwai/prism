import { waitForWorkerStart } from '#photos/main/worker-start';
import type { MainMessage, OpenedRoot, WorkerMessage } from '#photos/messages';
import type { CatalogFiles } from '@prism/catalog';
import { THREAD_POOL_SIZE } from '@prism/media';
import {
  debug,
  errorMessage,
  Listeners,
  type PhotoBackend,
  type StillImageRequest,
  type StillImageResponse,
  WorkerClient,
} from '@prism/shared';
import { MessageChannelMain, type MessagePortMain, nativeImage, utilityProcess } from 'electron';
import path from 'node:path';

const CLOSED = 'Folder session closed.';
const logCalls = debug('main:calls');

/**
 * One worker owns one folder. Replacing or closing the folder disposes the worker. `upgrading`
 * is called if the worker upgrades the catalog before it opens the folder.
 */
export class PhotoBackendClient {
  private readonly child;
  private readonly client: WorkerClient<PhotoBackend>;
  private readonly forgottenListeners = new Listeners();
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
      this.child.postMessage({ kind: 'call', request } satisfies MainMessage);
    }, logCalls);
    this.child.on('message', (message: WorkerMessage) => {
      switch (message.kind) {
        case 'stillImageRequest': {
          this.renderStillImage(message.stillImage);
          break;
        }
        case 'detailsForgotten': {
          this.forgottenListeners.tell();
          break;
        }
        case 'value':
        case 'error': {
          this.client.receive(message);
          break;
        }
        default: {
          // Starting up is `waitForWorkerStart`'s to handle.
          break;
        }
      }
    });
    this.child.once('exit', () => this.stop());
    this.folder = waitForWorkerStart(this.child, upgrading);
    this.folder.catch(() => this.stop());
  }

  /** Hears that the worker's catalog finished forgetting every photo's details. */
  onDetailsForgotten(listener: () => void): () => void {
    return this.forgottenListeners.add(listener);
  }

  async call<Method extends keyof PhotoBackend>(
    method: Method,
    ...args: Parameters<PhotoBackend[Method]>
  ): Promise<Awaited<ReturnType<PhotoBackend[Method]>>> {
    await this.folder;
    return this.client.call(method, ...args);
  }

  /**
   * A port the window calls the worker on directly, sparing the main process every folder read and
   * thumbnail. It closes when the worker stops.
   */
  async connect(): Promise<MessagePortMain> {
    await this.folder;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ kind: 'connect' } satisfies MainMessage, [port1]);
    return port2;
  }

  /**
   * Sends the worker whether a Prism window is focused, which makes it read photos' details
   * faster. It is sent once the folder is open, because the worker reads no messages before.
   */
  focus(focused: boolean): void {
    this.folder.then(
      () => {
        if (!this.stopped) {
          // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
          this.child.postMessage({ focused, kind: 'focus' } satisfies MainMessage);
        }
      },
      () => null,
    );
  }

  /**
   * A still image of a video from the system's own thumbnailer: Quick Look, or the Windows shell.
   */
  private async renderStillImage({
    id,
    source,
    width,
    height,
  }: StillImageRequest['stillImage']): Promise<void> {
    let response: StillImageResponse;
    try {
      const image = await nativeImage.createThumbnailFromPath(source, { height, width });
      if (image.isEmpty()) {
        throw new Error('The file has no still image to show.');
      }
      response = {
        kind: 'stillImageResponse',
        stillImage: { id, image: image.toPNG(), kind: 'image' },
      };
    } catch (error) {
      response = {
        kind: 'stillImageResponse',
        stillImage: { error: errorMessage(error), id, kind: 'error' },
      };
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
