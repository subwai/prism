/**
 * Whole-window placeholder: a centered label with a tw-shimmer highlight sweeping across it,
 * over the window's macOS vibrancy (tinted like the sidebar) rather than an opaque fill.
 */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <main
      role="status"
      className="drag bg-sidebar flex h-dvh items-center justify-center select-none"
    >
      {/* Negative right margin cancels the tracking after the last letter so it centers optically. */}
      <span className="shimmer text-title text-label-tertiary -mr-[0.35em] font-extralight tracking-[0.35em] uppercase">
        {label}
      </span>
    </main>
  );
}
