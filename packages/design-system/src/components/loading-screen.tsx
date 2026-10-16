/**
 * Whole-window placeholder: a centered label with a tw-shimmer highlight sweeping across it,
 * over the window's macOS vibrancy (tinted like the sidebar) rather than an opaque fill.
 */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <main
      role="status"
      className="drag flex h-dvh items-center justify-center bg-sidebar select-none"
    >
      {/* Negative right margin cancels the tracking after the last letter so it centers optically. */}
      <span className="shimmer -mr-[0.35em] text-title font-extralight tracking-[0.35em] text-label-tertiary uppercase">
        {label}
      </span>
    </main>
  );
}
