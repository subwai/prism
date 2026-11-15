import { createDebug, type Debugger, enable } from 'obug';

/**
 * `value` as JSON, with binary data, such as a video's still the window hands the worker, as
 * its size: written out, every byte would make a line of megabytes, and take as long to make.
 */
function json(value: unknown) {
  return JSON.stringify(value, (_key, inner: unknown) =>
    ArrayBuffer.isView(inner) || inner instanceof ArrayBuffer
      ? `<${inner.byteLength} bytes>`
      : inner,
  );
}

/** Fills a printf-style `format` with `args`, as `console` would. */
export function printf(format: string, args: unknown[]): string {
  let next = 0;
  const filled = format.replaceAll(/%[sdioOj]/gu, (directive) => {
    const value = args[next];
    next += 1;
    if (directive === '%d' || directive === '%i') {
      return String(Number(value));
    }
    return typeof value === 'string' ? value : json(value);
  });
  return [filled, ...args.slice(next).map((value) => json(value))].join(' ');
}

/**
 * The window's logs as whole lines: the main process forwards its console to the terminal as
 * text, which would show the format and its arguments apart.
 */
const windowOptions = {
  formatArgs(this: Debugger, diff: number, args: [string, ...unknown[]]) {
    args.splice(
      0,
      args.length,
      `${this.namespace} ${printf(args[0], args.slice(1))} +${this.humanize(diff)}`,
    );
  },
  useColors: false,
};

/**
 * A log of one part of the app, silent unless `DEBUG` names it: `DEBUG=prism:*` shows every
 * part, `DEBUG=prism:worker:*` the worker's. Each process logs under its own name, such as
 * `prism:worker:changes`, and the window's lines reach the terminal through the main process.
 */
export function debug(namespace: string): Debugger {
  return createDebug(`prism:${namespace}`, 'document' in globalThis ? windowOptions : undefined);
}

/** Turns on the logs `namespaces` names, for a process that cannot read `DEBUG` itself. */
export function enableDebug(namespaces: string): void {
  enable(namespaces);
}
