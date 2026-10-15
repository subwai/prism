import type { BackendResponse, PhotoBackend } from '#photos/backend';
import type { PhotoFolder } from '@app/shared';
import { utilityProcess } from 'electron';
import path from 'node:path';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const MAX_PENDING = 256,
  STARTUP_TIMEOUT_MS = 15_000;

/** One worker owns one folder. Replacing or closing the folder disposes the worker. */
export class PhotoBackendClient {
  private readonly child;
  readonly folder: Promise<PhotoFolder>;
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<number, Pending>();

  constructor(root: string, cacheDirectory: string) {
    this.child = utilityProcess.fork(
      path.join(import.meta.dirname, 'photos-worker.js'),
      [root, cacheDirectory],
      {
        serviceName: 'Photo library'
      }
    );
    this.folder = new Promise<PhotoFolder>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Photo backend did not start.'));
        this.stop();
      }, STARTUP_TIMEOUT_MS);
      this.child.on('message', (message: BackendResponse | { ready: PhotoFolder }) => {
        if ('ready' in message) {
          clearTimeout(timer);
          resolve(message.ready);
          return;
        }
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if ('error' in message) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.value);
          }
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
    const cancellation = method === 'cancelScan' || method === 'cancelThumbnail';
    if (this.stopped || (!cancellation && this.pending.size >= MAX_PENDING)) {
      throw new Error('Photo backend is stopped or busy.');
    }
    const id = this.sequence;
    this.sequence += 1;
    return new Promise<Awaited<ReturnType<PhotoBackend[Method]>>>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as Awaited<ReturnType<PhotoBackend[Method]>>)
      });
      try {
        // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
        this.child.postMessage({ args, id, method });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  stop(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.child.kill();
      for (const pending of this.pending.values()) {
        pending.reject(new Error('Folder session closed.'));
      }
      this.pending.clear();
    }
  }
}
