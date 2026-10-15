import { net, protocol } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BAD_REQUEST = 400,
  FORBIDDEN = 403,
  NOT_FOUND = 404;

function serveFile(file: string): Response | Promise<Response> {
  if (!existsSync(file)) {
    return new Response('Not found', { status: NOT_FOUND });
  }
  return net.fetch(pathToFileURL(file).href);
}

function resolveFile(root: string, pathname: string): string | Response {
  let file = '';
  try {
    file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  } catch {
    return new Response('Bad request', { status: BAD_REQUEST });
  }
  if (file !== root && !file.startsWith(root + path.sep)) {
    return new Response('Forbidden', { status: FORBIDDEN });
  }
  // Browser-history routes must resolve to the SPA shell on direct loads and refreshes.
  if (!path.extname(file)) {
    return path.resolve(root, 'index.html');
  }
  return file;
}

function serveURL(root: string, url: URL): Response | Promise<Response> {
  if (url.host !== 'app') {
    return new Response('Not found', { status: NOT_FOUND });
  }
  const file = resolveFile(root, url.pathname);
  if (file instanceof Response) {
    return file;
  }
  return serveFile(file);
}

export function registerAppProtocol(): void {
  const root = path.resolve(import.meta.dirname, '../renderer/client');
  protocol.handle('app', (request) => serveURL(root, new URL(request.url)));
}
