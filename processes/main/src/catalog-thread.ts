import { errorMessage } from '#photos/errors';
import { type CatalogAPI, createCatalogHost } from '@prism/catalog';
import type { WorkerRequest, WorkerResponse } from '@prism/shared';
import { parentPort, workerData } from 'node:worker_threads';

const { file, root } = workerData as { file: string; root: string };
if (!parentPort) {
  throw new Error('Start the catalog as a worker thread.');
}
const port = parentPort;
const host = createCatalogHost(file, root, (event) => port.postMessage({ event }));

// Requests come from the folder's worker alone, which checked what the window sent.
port.on('message', (request: WorkerRequest | { close: true }) => {
  if ('close' in request) {
    host.close();
    port.close();
    return;
  }
  let response: WorkerResponse;
  try {
    const method = host[request.method as keyof CatalogAPI];
    response = { id: request.id, value: Reflect.apply(method, host, request.args) };
  } catch (error) {
    response = { error: errorMessage(error), id: request.id };
  }
  port.postMessage(response);
});
