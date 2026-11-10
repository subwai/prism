import { type CatalogFiles, CatalogHost } from '@prism/catalog';
import { serve, type WorkerRequest } from '@prism/shared';
import { parentPort, workerData } from 'node:worker_threads';

const { files, root } = workerData as { files: CatalogFiles; root: string };
if (!parentPort) {
  throw new Error('Start the catalog as a worker thread.');
}
const port = parentPort;
const host = new CatalogHost(files, root, (event) => port.postMessage({ event }));

// Requests come from the folder's worker alone, which checked what the window sent.
port.on('message', (request: WorkerRequest | { close: true }) => {
  if ('close' in request) {
    host.close();
    port.close();
    return;
  }
  // The catalog answers at once, so each answer goes before the next request is read.
  serve(host, request).then((response) => port.postMessage(response));
});
