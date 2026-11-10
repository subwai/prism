import type { FrameReader } from '@prism/media';
import type { FrameRequest, FrameResponse } from '@prism/shared';

/** Stills asked of the main process and not yet answered, by request. */
const frames = new Map<number, PromiseWithResolvers<Uint8Array>>();
let sequence = 0;

/**
 * A still of a video or HEIF photo from Quick Look or the Windows shell, which only the main
 * process can reach, asked for over `port`. Its answer comes back through `receiveFrame`.
 */
export function readFrame(
  port: { postMessage: (message: FrameRequest) => void },
  ...[source, { width, height }, signal]: Parameters<FrameReader>
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const id = sequence;
  sequence += 1;
  const request = Promise.withResolvers<Uint8Array>();
  frames.set(id, request);
  // The signal is the library's, which outlives the request, so it stops listening once answered.
  const answered = new AbortController();
  signal.addEventListener('abort', () => request.reject(signal.reason), {
    once: true,
    signal: answered.signal,
  });
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC has no targetOrigin.
  port.postMessage({ frame: { height, id, source, width } });
  return request.promise.finally(() => {
    frames.delete(id);
    answered.abort();
  });
}

/** Settles the request the main process answered. */
export function receiveFrame({ frame }: FrameResponse): void {
  const request = frames.get(frame.id);
  if ('image' in frame) {
    request?.resolve(frame.image);
  } else {
    request?.reject(new Error(frame.error));
  }
}
