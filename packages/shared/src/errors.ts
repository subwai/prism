/** What `error` says, for a message: an error's own message, or anything else as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
