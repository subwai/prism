// The system says why a file call failed with a short code, such as ENOENT ("error, no entry":
// nothing is at the path). This module is the one place that reads those codes.

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

/**
 * Whether `error` says nothing is there, rather than that something there cannot be read: no
 * entry at the path (ENOENT), or a folder on the way to it that is now a file (ENOTDIR). Use it
 * to tell that an entry is gone, by whatever route.
 */
export function isNotFoundOrNotAFolder(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Whether `error` says the volume a path is on does not answer. */
export function isOfflineError(error: unknown): boolean {
  return OFFLINE_CODES.has((error as NodeJS.ErrnoException | undefined)?.code ?? '');
}

/**
 * Whether `error` says no entry is at the path (ENOENT), and nothing else. Use it where a folder
 * on the way that is now a file is a failure to report, rather than an entry that is gone.
 */
export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Whether `error` says the target name is taken: a file is there (EEXIST), or a folder that
 * holds something (ENOTEMPTY).
 */
export function isNameTaken(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}

/** Whether `error` says the disk is read-only (EROFS). */
export function isReadOnly(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EROFS';
}

/** Whether `error` says the system did not allow the call (EACCES or EPERM). */
export function isNotAllowed(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'EACCES' || code === 'EPERM';
}
