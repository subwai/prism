import { type HostRole, openHost } from '#host';
import type { WorkerRequest } from '@prism/shared';
import { Worker } from 'node:worker_threads';

type Message = WorkerRequest | { close: true };

export interface Channel {
  post: (message: Message) => void;
  close: () => Promise<void>;
}

/** Starts a host of the catalog, as `role` says, which answers through `receive`. */
export type Connect = (role: HostRole, receive: (message: unknown) => void) => Channel;

/**
 * A host of the catalog on this thread, answering each call after the current task, as tests
 * run it: they run the sources as they are rather than bundled, which a thread cannot.
 */
export function inProcessHost(role: HostRole, receive: (message: unknown) => void): Channel {
  const host = openHost(role, (event) => receive({ event }));
  return {
    close() {
      host.close();
      return Promise.resolve();
    },
    post(message) {
      if ('close' in message) {
        return;
      }
      queueMicrotask(() => {
        host.serve(message).then(receive);
      });
    },
  };
}

/** A host of the catalog on a thread of its own, which runs the script `entry`. */
export function threadHost(entry: string): Connect {
  return (role, receive) => {
    const worker = new Worker(entry, { workerData: role });
    worker.on('message', receive);
    return {
      close: async () => {
        // eslint-disable-next-line unicorn/require-post-message-target-origin -- A worker thread has no targetOrigin.
        worker.postMessage({ close: true });
        await new Promise((resolve) => {
          worker.once('exit', resolve);
        });
      },
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- A worker thread has no targetOrigin.
      post: (message) => worker.postMessage(message),
    };
  };
}

/**
 * A channel that holds what is posted to it until `opening` settles with the channel to send it
 * on, or with `null` to drop it, as for a host that never started.
 */
export function openedLater(opening: Promise<Channel | null>): Channel {
  const held: Message[] = [];
  let opened: Channel | null | undefined;
  opening.then((channel) => {
    opened = channel;
    for (const message of held.splice(0)) {
      channel?.post(message);
    }
  });
  return {
    close: async () => {
      await (await opening)?.close();
    },
    post(message) {
      if (opened === undefined) {
        held.push(message);
      } else {
        opened?.post(message);
      }
    },
  };
}
