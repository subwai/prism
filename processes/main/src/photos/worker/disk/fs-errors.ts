/** Errors that say the volume does not answer, rather than that nothing is at the path. */
const OFFLINE_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'EIO',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTCONN',
  'ENXIO',
  'ESTALE',
  'ETIMEDOUT',
]);

/** Whether `error` says nothing is there, rather than that something there cannot be read. */
export function isMissing(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Whether `error` says the volume a path is on does not answer. */
export function isOfflineError(error: unknown): boolean {
  return OFFLINE_CODES.has((error as NodeJS.ErrnoException | undefined)?.code ?? '');
}

/**
 * Whether `error` says nothing is at the path itself. Unlike `isMissing`, a path that runs
 * through a file, rather than a folder, does not count.
 */
export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
