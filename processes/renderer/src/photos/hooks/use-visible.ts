import { useLibrary } from '#photos/hooks/use-library';
import { useCallback, useState } from 'react';

/** What each observed element does as it comes into view or leaves it. */
const watchers = new WeakMap<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

/** One observer for every tile, rather than one each. */
function observe(node: Element, watch: (visible: boolean) => void) {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      watchers.get(entry.target)?.(entry.isIntersecting);
    }
  });
  watchers.set(node, watch);
  observer.observe(node);
  return () => {
    observer?.unobserve(node);
    watchers.delete(node);
  };
}

/**
 * Rendering overscan must not start work for images outside the viewport. Visible entries
 * are also marked as wanted, so queued work for ones scrolled past yields to them.
 */
export function useVisible(entryId: string) {
  const library = useLibrary();
  const [visible, setVisible] = useState(false);
  const ref = useCallback(
    (node: HTMLDivElement) => {
      let release: (() => void) | null = null;
      const stop = observe(node, (intersecting) => {
        if (intersecting && !release) {
          release = library.want(entryId);
        } else if (!intersecting && release) {
          release();
          release = null;
        }
        setVisible(intersecting);
      });
      return () => {
        stop();
        release?.();
      };
    },
    [library, entryId]
  );
  return { ref, visible };
}
