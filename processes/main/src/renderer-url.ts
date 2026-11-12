import { app } from 'electron';

/** Where the application window loads from: the bundled app, or the dev server. */
export function rendererURL(): URL {
  const devServer = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  return new URL(devServer ?? 'app://app/');
}

/** Whether `url` is one of the application window's own pages. */
export function isRendererURL(url: string): boolean {
  const allowed = rendererURL();
  const actual = URL.parse(url);
  return actual !== null && actual.protocol === allowed.protocol && actual.host === allowed.host;
}

/** Spelled out: Node does not know `app:` is a standard scheme, so its `origin` is "null". */
export function rendererOrigin(): string {
  const url = rendererURL();
  return `${url.protocol}//${url.host}`;
}
