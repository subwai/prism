import { useLocation } from 'react-router';

/** Whether there is anywhere to go back or forward to, from React Router's history state. */
export function useHistoryEnds() {
  // Re-render on every navigation; the position lives outside React.
  useLocation();
  const position = (globalThis.history.state as { idx?: number } | null)?.idx ?? 0;
  return { back: position > 0, forward: position < globalThis.history.length - 1 };
}
