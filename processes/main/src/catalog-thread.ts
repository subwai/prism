import { type HostRole, openHost } from '@prism/catalog';
import type { WorkerRequest } from '@prism/shared';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('Start the catalog as a worker thread.');
}
const port = parentPort;
// The catalog's writer, its reader, or both, as the folder's worker says.
const host = openHost(workerData as HostRole, (event) => port.postMessage({ event }));

// Requests come from the folder's worker alone, which checked what the window sent.
port.on('message', (request: WorkerRequest | { close: true }) => {
  if ('close' in request) {
    host.close();
    port.close();
    return;
  }
  // The catalog answers at once, so each answer goes before the next request is read.
  host.serve(request).then((response) => port.postMessage(response));
});
