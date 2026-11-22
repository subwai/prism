/** Returns an error's own message, or anything else that was thrown, as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
