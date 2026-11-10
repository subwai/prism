import publicSans from '@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2?url';

/**
 * The UI font's Latin file, to preload from the document's head. Otherwise it is fetched only
 * once the stylesheet has laid text out, so the first frames draw the fallback font, and text
 * such as the loading screen's label moves as it swaps in.
 */
export const fontPreloads = [
  { as: 'font', crossOrigin: 'anonymous', href: publicSans, rel: 'preload', type: 'font/woff2' },
] as const;
