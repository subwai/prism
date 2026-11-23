import type {
  PhotoRoot,
  StillImageRequest,
  StillImageResponse,
  WorkerRequest,
  WorkerResponse,
} from '@prism/shared';

/** The folder as the worker reads it; the main process names the session. */
export type OpenedRoot = Omit<PhotoRoot, 'session'>;

/**
 * What a library worker sends the main process:
 * - `upgrading`: as it starts, that it is upgrading the catalog;
 * - `ready`: that its folder is open;
 * - `stillImageRequest`: a still image of a video it asks for;
 * - `detailsForgotten`: a forget of every photo's details is done. It reached every library's
 *   photos, so the other windows refresh;
 * - `value` and `error`: its answers to the main process's calls.
 */
export type WorkerMessage =
  | { kind: 'upgrading' }
  | { kind: 'ready'; folder: OpenedRoot }
  | { kind: 'detailsForgotten' }
  | StillImageRequest
  | WorkerResponse;

/**
 * What the main process sends a library worker:
 * - `call`: a call of one of the worker's methods;
 * - `stillImageResponse`: the still image the worker asked for;
 * - `connect`: a window's port, which comes with the message;
 * - `focus`: whether a Prism window is focused.
 */
export type MainMessage =
  | { kind: 'call'; request: WorkerRequest }
  | StillImageResponse
  | { kind: 'connect' }
  | { kind: 'focus'; focused: boolean };
