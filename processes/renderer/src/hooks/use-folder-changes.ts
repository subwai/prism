import type { PhotoLibrary } from '#data/library';
import { useEffect, useEffectEvent } from 'react';
import { useRevalidator } from 'react-router';

/**
 * Reads the open view again through the router when the library says its folder is gone, or
 * too much changed to patch; the library patches everything else in place itself.
 */
export function useFolderChanges(library: PhotoLibrary) {
  const revalidator = useRevalidator();
  const revalidate = useEffectEvent(() => revalidator.revalidate());
  useEffect(() => {
    // One reload at a time: each new one would cancel the last, so steady changes, such as a
    // long copy, would otherwise keep the view from ever reloading.
    let reloading = false;
    let again = false;
    async function reload() {
      if (reloading) {
        again = true;
        return;
      }
      reloading = true;
      do {
        again = false;
        await revalidate();
      } while (again);
      reloading = false;
    }
    return library.onLost(() => {
      reload().catch(() => {
        reloading = false;
      });
    });
  }, [library]);
}
