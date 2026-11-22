/** Work the scheduler let go before it started, as nothing wanted it any more. */
export class DroppedError extends Error {
  constructor() {
    super('Nothing wants this any more.');
    this.name = 'DroppedError';
  }
}
