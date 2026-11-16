import { availableParallelism } from 'node:os';

// Sharp decodes each image on one thread; half the cores leaves the rest to the window.
export const THUMBNAIL_CONCURRENCY = Math.max(2, Math.floor(availableParallelism() / 2));
/**
 * Thumbnails made at once, each read whole and then decoded in one of `THUMBNAIL_CONCURRENCY`
 * turns. A read from a network share mostly waits on the network, 70–300 ms a photo, so more
 * are read at once than decoded, as many as a share answers about as fast as one.
 */
export const THUMBNAIL_READS = Math.max(16, THUMBNAIL_CONCURRENCY);
// Each conversion decodes a full-size photo, for the one the viewer opens.
export const CONVERSION_CONCURRENCY = 2;
/**
 * File calls the indexer makes at once, across every folder it reads. A network share answers
 * many at once about as fast as one, while a local disk gains little past a few. Each has a
 * thread of its own, so none waits in libuv's queue, which is first in, first out: a thousand
 * queued `stat` calls of a share kept a cached thumbnail's waiting for seconds.
 */
export const INDEX_CONCURRENCY = 16;
// Left for file work beside the decodes and the indexer: a cached thumbnail is found with a
// `realpath` and two `stat` calls.
const SPARE_THREADS = 4;

/**
 * The size of libuv's thread pool in a folder's worker, which runs Sharp's decodes and every
 * asynchronous file call alike. Its default of 4 is fewer than the decodes the worker allows,
 * so they queued inside libuv, and a `stat` for a cached thumbnail waited up to 100 ms behind
 * them. A thumbnail being made reads or decodes on one thread at a time, so its reads count for
 * its decodes. libuv reads it from `UV_THREADPOOL_SIZE` as the process starts.
 */
export const THREAD_POOL_SIZE =
  THUMBNAIL_READS + CONVERSION_CONCURRENCY + INDEX_CONCURRENCY + SPARE_THREADS;
