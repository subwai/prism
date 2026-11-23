import { developmentEnvironment, developmentExecutable } from './development-app.ts';
import { resolveConfig } from 'electron-vite';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { build, createServer, mergeConfig, type UserConfig } from 'vite';

/**
 * Runs Prism in development. Vite serves the renderer, and builds the main process and the
 * preload script again whenever they change: a new main restarts Electron, and a new preload
 * reloads the window. The renderer uses React Router's framework mode, which needs its own Vite
 * config and dev server, so it is served apart from the other two.
 */

// `process.argv` starts with Node and this script; the rest is passed on to Electron.
const ARGUMENT_OFFSET = 2;
const EXIT_ERROR = 1;
const EXIT_OK = 0;
const SHUTDOWN_TIMEOUT = 3000;
const executable = await developmentExecutable();
const server = await createServer({
  configFile: path.resolve('processes/renderer/vite.config.ts'),
});
const watchers: { close: () => Promise<void> }[] = [];
let electron: ChildProcess | false = false;
let restarts = Promise.resolve();
let stopping = false;

function reportError(error: unknown): void {
  process.stderr.write(`${String(error)}\n`);
}

/** Asks `child` to quit, and kills it if it hasn't after a few seconds. */
async function terminateChild(child: ChildProcess): Promise<void> {
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT);
  child.kill();
  await exited;
  clearTimeout(timeout);
}

async function stopElectron(): Promise<void> {
  const child = electron;
  electron = false;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await terminateChild(child);
}

async function shutdown(code: number): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  await restarts.catch(reportError);
  await stopElectron();
  await Promise.all(watchers.map((watcher) => watcher.close()));
  await server.close();
  process.exitCode = code;
}

function launchElectron(): void {
  if (stopping) {
    return;
  }
  if (!server.resolvedUrls) {
    throw new Error('Renderer dev server has no local URL');
  }
  process.env.ELECTRON_RENDERER_URL = server.resolvedUrls.local.at(0);
  const child = spawn(executable, ['.', ...process.argv.slice(ARGUMENT_OFFSET)], {
    env: developmentEnvironment(),
    stdio: 'inherit',
  });
  electron = child;
  child.once('error', (error) => {
    reportError(error);
    shutdown(EXIT_ERROR);
  });
  child.once('exit', (code) => {
    if (electron === child) {
      shutdown(code ?? EXIT_ERROR);
    }
  });
}

function restartElectron(): Promise<void> {
  restarts = restarts.then(stopElectron).then(launchElectron);
  return restarts;
}

/** Builds `config` and keeps rebuilding it on changes; resolves once the first build is done. */
function buildAndWatch(config: UserConfig, onRebuild: () => void): Promise<void> {
  return new Promise((markReady, reject) => {
    let ready = false;
    build(
      mergeConfig(config, {
        plugins: [
          {
            closeBundle(): void {
              if (ready) {
                onRebuild();
              } else {
                ready = true;
                markReady();
              }
            },
            name: 'electron-development-reload',
          },
        ],
      }),
    )
      .then((watcher) => {
        if (!('close' in watcher)) {
          throw new Error('Expected a build watcher');
        }
        watchers.push(watcher);
      })
      .catch(reject);
  });
}

process.once('SIGINT', () => {
  shutdown(EXIT_OK);
});
process.once('SIGTERM', () => {
  shutdown(EXIT_OK);
});

try {
  await server.listen();
  server.printUrls();
  const { config } = await resolveConfig(
    {
      build: { watch: {} },
      ignoreConfigWarning: true,
    },
    'serve',
  );
  if (!config || !config.main || !config.preload) {
    throw new Error('Expected main and preload build configurations');
  }
  await buildAndWatch(config.main, () => {
    restartElectron();
  });
  await buildAndWatch(config.preload, () => {
    server.ws.send({ type: 'full-reload' });
  });
  await restartElectron();
} catch (error) {
  reportError(error);
  await shutdown(EXIT_ERROR);
}
