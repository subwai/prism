import { GalleryStatus } from '#components/gallery/gallery-status';
import { Toolbar } from '#components/gallery/toolbar';
import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import { usePageWidth, useThumbnailSize } from '#components/gallery/use-thumbnail-size';
import type { ScanState } from '#data/directory-scan';
import type { ViewMode } from '#data/entries';
import type { FolderTrail } from '#data/library';
import type { GalleryData } from '#data/route-loaders';
import { useGlobalCommands } from '#keyboard/commands';
import { Spinner } from '@prism/design-system';
import { type ReactNode, Suspense, useDeferredValue } from 'react';
import { Await } from 'react-router';

const NOTHING_YET: ScanState = {
  entries: [],
  error: null,
  errors: [],
  loading: true,
  sorting: false,
};

/**
 * A gallery view, once its loader has it. A view that was ready when the navigation committed
 * shows at once; one still loading shows its toolbar and a spinner, then fades in. Key it by
 * folder: a re-sort or refresh of the same one keeps showing it until the next is ready.
 */
export function AwaitGallery({
  mode,
  trail,
  gallery,
  children,
}: {
  mode: ViewMode;
  trail: FolderTrail;
  gallery: GalleryData | Promise<GalleryData>;
  children: (data: GalleryData) => ReactNode;
}) {
  // Deferred, an update that suspends leaves what is shown in place; the first render has
  // nothing to keep, so it shows the spinner. What it waited for fades in.
  const shown = useDeferredValue(gallery);
  return (
    <Suspense fallback={<LoadingGallery mode={mode} trail={trail} />}>
      <Await resolve={shown}>
        {(data: GalleryData) => (
          // Only the view's contents fade in: its toolbar and background were there already,
          // and fading them would show the desktop through the window for a moment.
          <div
            className="group/gallery contents"
            data-waited={shown instanceof Promise || undefined}
          >
            {children(data)}
          </div>
        )}
      </Await>
    </Suspense>
  );
}

/** The toolbar and status bar a view will have, around a spinner where its contents go. */
function LoadingGallery({ mode, trail }: { mode: ViewMode; trail: FolderTrail }) {
  const navigation = useGalleryNavigation(mode, trail);
  const thumbnailSize = useThumbnailSize();
  const pageWidth = usePageWidth();
  const [size, setSize] = mode === 'reader' ? pageWidth : thumbnailSize;
  useGlobalCommands({ back: navigation.back, forward: navigation.forward, up: navigation.up });
  return (
    <main className="bg-content-fade flex min-w-0 flex-1 flex-col" aria-busy>
      <h1 className="sr-only">{trail.at(-1)?.name}</h1>
      <Toolbar trail={trail} mode={mode} entries={[]} refreshes={0} />
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} label="Loading folder" />
      </div>
      <GalleryStatus
        pending
        mode={mode}
        scan={NOTHING_YET}
        count={0}
        selected={null}
        size={size}
        onSize={setSize}
      />
    </main>
  );
}
