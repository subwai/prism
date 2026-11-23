import type { StillImageReader } from '@prism/media';
import type { StillImageRequest, StillImageResponse } from '@prism/shared';

/** Still images asked of the main process and not yet answered, by request. */
const stillImageRequests = new Map<number, PromiseWithResolvers<Uint8Array>>();
let sequence = 0;

/**
 * A still image of a video or HEIF photo from Quick Look or the Windows shell, which only the main
 * process can reach, asked for over `port`. Its answer comes back through `receiveStillImage`.
 */
export function readStillImage(
  port: { postMessage: (message: StillImageRequest) => void },
  ...[source, { width, height }, signal]: Parameters<StillImageReader>
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const id = sequence;
  sequence += 1;
  const request = Promise.withResolvers<Uint8Array>();
  stillImageRequests.set(id, request);
  // The signal is the library's, which outlives the request, so it stops listening once answered.
  const answered = new AbortController();
  signal.addEventListener('abort', () => request.reject(signal.reason), {
    once: true,
    signal: answered.signal,
  });
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no
  // targetOrigin.
  port.postMessage({ kind: 'stillImageRequest', stillImage: { height, id, source, width } });
  return request.promise.finally(() => {
    stillImageRequests.delete(id);
    answered.abort();
  });
}

/** Settles the request the main process answered. */
export function receiveStillImage({ stillImage }: StillImageResponse): void {
  const request = stillImageRequests.get(stillImage.id);
  switch (stillImage.kind) {
    case 'image': {
      request?.resolve(stillImage.image);
      break;
    }
    default: {
      request?.reject(new Error(stillImage.error));
    }
  }
}
