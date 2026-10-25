import { renderToReadableStream } from 'react-dom/server';
import { type EntryContext, ServerRouter } from 'react-router';

// SPA mode still renders the root shell once at build time.
export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
): Promise<Response> {
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />);
  await body.allReady;
  headers.set('Content-Type', 'text/html');
  return new Response(body, { headers, status });
}
