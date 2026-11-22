import { createDebug, type Debugger, enable } from 'obug';

/**
 * Turns `value` into JSON for a log line, writing binary data, such as a video still the window
 * hands the worker, as its size only. Written out in full, every byte would make a line
 * megabytes long, and take as long to build.
 */
function json(value: unknown) {
  return JSON.stringify(value, (_key, inner: unknown) =>
    ArrayBuffer.isView(inner) || inner instanceof ArrayBuffer
      ? `<${inner.byteLength} bytes>`
      : inner,
  );
}

/**
 * Fills the placeholders in `format`, such as `%s` and `%d`, with `args`, as `console.log`
 * does. Arguments left over are added at the end.
 */
export function printf(format: string, args: unknown[]): string {
  let next = 0;
  const filled = format.replaceAll(/%[sdioOj]/gu, (placeholder) => {
    const value = args[next];
    next += 1;
    if (placeholder === '%d' || placeholder === '%i') {
      return String(Number(value));
    }
    return typeof value === 'string' ? value : json(value);
  });
  return [filled, ...args.slice(next).map((value) => json(value))].join(' ');
}

/**
 * Makes the window's logs whole lines of text. The main process forwards the window's console to
 * the terminal as text, which would otherwise show the format and its arguments separately.
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
 * Creates the log of one part of the app, which stays silent unless the `DEBUG` environment
 * variable names it. `DEBUG=prism:*` turns on every part, and `DEBUG=prism:worker:*` the
 * worker's. Each process logs under its own name, such as `prism:worker:changes`, and the
 * window's lines reach the terminal through the main process.
 */
export function debug(namespace: string): Debugger {
  return createDebug(`prism:${namespace}`, 'document' in globalThis ? windowOptions : undefined);
}

/** Turns on the logs `namespaces` names, for a process that cannot read `DEBUG` itself. */
export function enableDebug(namespaces: string): void {
  enable(namespaces);
}
