import type {
  FrameRequest,
  FrameResponse,
  PhotoRoot,
  WorkerRequest,
  WorkerResponse,
} from '@prism/shared';

/** The folder as the worker reads it; the main process names the session. */
export type OpenedRoot = Omit<PhotoRoot, 'session'>;

/**
 * What a folder's worker sends the main process:
 * - `upgrading`: as it starts, that it is upgrading the catalog;
 * - `ready`: that its folder is open;
 * - `frameRequest`: a still of a video it asks for;
 * - `value` and `error`: its answers to the main process's calls.
 */
export type WorkerMessage =
  | { kind: 'upgrading' }
  | { kind: 'ready'; folder: OpenedRoot }
  | FrameRequest
  | WorkerResponse;

/**
 * What the main process sends a folder's worker:
 * - `call`: a call of one of the worker's methods;
 * - `frameResponse`: the still the worker asked for;
 * - `connect`: a window's port, which comes with the message;
 * - `focus`: whether a Prism window is focused.
 */
export type MainMessage =
  | { kind: 'call'; request: WorkerRequest }
  | FrameResponse
  | { kind: 'connect' }
  | { kind: 'focus'; focused: boolean };
