/** A read the library's folder being offline stopped, which says nothing of what it read. */
export class ShareOfflineError extends Error {
  constructor() {
    super('The share this library is on is offline.');
    this.name = 'ShareOfflineError';
  }
}
