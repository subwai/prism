import { availableParallelism } from 'node:os';

// Sharp decodes each image on one thread; half the cores leaves the rest to the window.
export const THUMBNAIL_CONCURRENCY = Math.max(2, Math.floor(availableParallelism() / 2));
// Each conversion decodes a full-size photo, for the one the viewer opens.
export const CONVERSION_CONCURRENCY = 2;
// Left for file work beside the decodes: a cached thumbnail is found with one `stat`.
const SPARE_THREADS = 4;

/**
 * The size of libuv's thread pool in a folder's worker, which runs Sharp's decodes and every
 * asynchronous file call alike. Its default of 4 is fewer than the decodes the worker allows,
 * so they queued inside libuv, and a `stat` for a cached thumbnail waited up to 100 ms behind
 * them. libuv reads it from `UV_THREADPOOL_SIZE` as the process starts.
 */
export const THREAD_POOL_SIZE = THUMBNAIL_CONCURRENCY + CONVERSION_CONCURRENCY + SPARE_THREADS;
