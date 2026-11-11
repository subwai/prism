import { QueryValue } from '#components/query-value';
import { Unavailable } from '#components/viewer/unavailable';
import { useCachedThumbnail, useLibrary } from '#hooks/use-library';
import { cn } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useQuery } from '@tanstack/react-query';
import { elementScroll, type Virtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';
import { useState } from 'react';

/** How long turning a page scrolls for: brisker than Chromium's own smooth scrolling. */
const TURN_MS = 250;

/** The frame each reader is waiting on while it turns a page. */
const turns = new WeakMap<Element, number>();

/**
 * Scrolls smoothly on a short ease-out curve of its own, as the virtualizer's smooth scrolling
 * example does, since `scrollTo` has no say over how long its own animation takes. Scrolling
 * that is not smooth goes straight there.
 */
export const scrollPages: VirtualizerOptions<HTMLElement, Element>['scrollToFn'] = (
  offset,
  options,
  instance,
) => {
  const element = instance.scrollElement;
  if (!element) {
    return;
  }
  cancelAnimationFrame(turns.get(element) ?? 0);
  if (options.behavior !== 'smooth') {
    elementScroll(offset, options, instance);
    return;
  }
  const from = element.scrollTop;
  const to = offset + (options.adjustments ?? 0);
  const start = performance.now();
  function frame(now: number) {
    if (!element) {
      return;
    }
    const progress = Math.min(1, (now - start) / TURN_MS);
    element.scrollTop = from + (to - from) * (1 - (1 - progress) ** 3);
    if (progress < 1) {
      turns.set(element, requestAnimationFrame(frame));
    }
  }
  turns.set(element, requestAnimationFrame(frame));
};

/**
 * The page at the top of the reader, or the last once it has scrolled to the end. Unscrolled,
 * the first is at the top, however tall the pages are: before they have heights they all fit,
 * which would otherwise count as the end.
 */
export function pageAt(virtualizer: Virtualizer<HTMLElement, Element>) {
  const offset = virtualizer.scrollOffset ?? 0;
  if (offset === 0) {
    return 0;
  }
  if (virtualizer.isAtEnd(1)) {
    return virtualizer.options.count - 1;
  }
  return virtualizer.getVirtualItemForOffset(offset + 1)?.index ?? 0;
}

/** The page's thumbnail, scaled up: the cached one, or else one made now. */
function PageThumbnail({ entry }: { entry: PhotoEntry }) {
  const library = useLibrary();
  const cached = useCachedThumbnail(entry);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  // Made only once the cached one is missing, and read without suspending, as a tile's is.
  const { data: thumbnail } = useQuery({
    ...library.thumbnailQuery(entry.id),
    enabled: missing === cached,
  });
  if (missing !== cached) {
    // A page's height until it loads, as the reader places the pages below it by their heights.
    return (
      <img
        src={cached}
        alt=""
        draggable={false}
        className={cn('block w-full', loaded !== cached && 'aspect-page bg-fill')}
        onLoad={() => setLoaded(cached)}
        onError={() => setMissing(cached)}
      />
    );
  }
  return thumbnail?.status === 'ready' ? (
    <img src={thumbnail.url} alt="" draggable={false} className="block w-full" />
  ) : (
    <div className="aspect-page bg-fill" />
  );
}

/** A page's photo at the column's width, or its thumbnail, scaled up, until it has decoded. */
export function Page({ entry }: { entry: PhotoEntry }) {
  const library = useLibrary();
  // The original and thumbnail are read only while the page is rendered, so pages scrolled
  // past quickly leave the queue to the one the reader stops on.
  const want = () => library.want(entry.id);
  return (
    <div ref={want}>
      <QueryValue query={library.originalQuery(entry)}>
        {(url) => {
          if (url) {
            return <img src={url} alt={entry.name} draggable={false} className="block w-full" />;
          }
          if (url === null) {
            return (
              <div className="aspect-page relative">
                <Unavailable
                  title="Unable to display this page"
                  description="The original may be missing or use an unsupported format."
                />
              </div>
            );
          }
          return <PageThumbnail entry={entry} />;
        }}
      </QueryValue>
    </div>
  );
}
