import { LoadingState } from '#components/loading-state';

/**
 * Whole-window placeholder: a `LoadingState` over the window's translucent material (tinted
 * like the sidebar) rather than an opaque fill.
 */
export function LoadingScreen({ label }: { label?: string }) {
  return (
    <main className="drag bg-sidebar flex h-dvh">
      <LoadingState label={label} />
    </main>
  );
}
