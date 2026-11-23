import { LoadingState } from '#components/feedback/loading-state';
import { PrismMark } from '#components/media/prism-mark';

/**
 * Whole-window placeholder: the Prism mark over a `LoadingState`, on the window's translucent
 * material (tinted like the sidebar) rather than an opaque fill, as the loaded app is.
 */
export function LoadingScreen({ label }: { label?: string }) {
  return (
    <main className="drag bg-sidebar flex h-dvh w-full flex-col items-center justify-center gap-10">
      <PrismMark />
      <LoadingState label={label} className="flex-none" />
    </main>
  );
}
