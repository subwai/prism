import { forgetDetails, prepareIndex } from '@prism/catalog';
import { workerData } from 'node:worker_threads';

// Forgets every photo's details on a thread of its own: it rewrites a row for every photo the
// index holds, and waits its turn behind the folders' workers, which the main process, and
// with it every window, must not wait for.
const file = prepareIndex(workerData as string);
if (file !== ':memory:') {
  forgetDetails(file);
}
