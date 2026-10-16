import { useLibrary } from '#photos/hooks/use-library';
import { useCallback, useState } from 'react';

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
      const observer = new IntersectionObserver(([item]) => {
        const intersecting = item?.isIntersecting ?? false;
        if (intersecting && !release) {
          release = library.want(entryId);
        } else if (!intersecting && release) {
          release();
          release = null;
        }
        setVisible(intersecting);
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
        release?.();
      };
    },
    [library, entryId]
  );
  return { ref, visible };
}
