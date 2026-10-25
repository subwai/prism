import { QueryValue } from '#components/query-value';
import { Unavailable } from '#components/viewer/unavailable';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { elementScroll, type Virtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';
import { useCallback } from 'react';

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

/** The page at the top of the reader, or the last once it has scrolled to the end. */
export function pageAt(virtualizer: Virtualizer<HTMLElement, Element>) {
  if (virtualizer.isAtEnd(1)) {
    return virtualizer.options.count - 1;
  }
  return virtualizer.getVirtualItemForOffset((virtualizer.scrollOffset ?? 0) + 1)?.index ?? 0;
}

/** A page's photo at the column's width, or its thumbnail, scaled up, until it has decoded. */
export function Page({ entry }: { entry: PhotoEntry }) {
  const library = useLibrary();
  // The original and thumbnail are read only while the page is rendered, so pages scrolled
  // past quickly leave the queue to the one the reader stops on.
  const want = useCallback(() => library.want(entry.id), [library, entry.id]);
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
          return (
            <QueryValue query={library.thumbnailQuery(entry.id)}>
              {(thumbnail) =>
                thumbnail?.status === 'ready' ? (
                  <img src={thumbnail.url} alt="" draggable={false} className="block w-full" />
                ) : (
                  <div className="aspect-page bg-fill" />
                )
              }
            </QueryValue>
          );
        }}
      </QueryValue>
    </div>
  );
}
