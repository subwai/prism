import { type HostRole, openHost, threadHost } from '@prism/catalog';
import type { WorkerRequest } from '@prism/shared';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('Start the catalog as a worker thread.');
}
const port = parentPort;
// The catalog's writer, its reader, the maker of the reader's views, or all of them, as the
// thread that started this one says. Each host it starts runs this script too.
const host = openHost(
  workerData as HostRole,
  (event) => port.postMessage({ event, kind: 'event' }),
  threadHost(import.meta.filename),
);

// Requests come from the library worker, which checked what the window sent, or the reader.
port.on('message', (request: WorkerRequest | { close: true }) => {
  if ('close' in request) {
    host.close().then(() => port.close());
    return;
  }
  // Most calls answer at once, before the next request is read; opening or making a view again
  // answers once it is made, while the reader answers the reads after it.
  host.serve(request).then((response) => port.postMessage(response));
});
