import electronPath from 'electron';
import { resolveConfig } from 'electron-vite';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { build, createServer, mergeConfig, type UserConfig } from 'vite';

// Framework mode needs its own Vite config and document server.
const ARGUMENT_OFFSET = 2,
  EXIT_ERROR = 1,
  EXIT_OK = 0,
  SHUTDOWN_TIMEOUT = 3000,
  server = await createServer({ configFile: path.resolve('processes/renderer/vite.config.ts') }),
  watchers: { close: () => Promise<void> }[] = [];
let electron: ChildProcess | false = false,
  restarts = Promise.resolve(),
  stopping = false;

function reportError(error: unknown): void {
  process.stderr.write(`${String(error)}\n`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  const exited = once(child, 'exit'),
    timeout = setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT);
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
  process.env.ELECTRON_RENDERER_URL = server.resolvedUrls.local.at(EXIT_OK);
  const child = spawn(
    electronPath as unknown as string,
    ['.', ...process.argv.slice(ARGUMENT_OFFSET)],
    {
      stdio: 'inherit',
    },
  );
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

function watch(config: UserConfig, onRebuild: () => void): Promise<void> {
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
  await watch(config.main, () => {
    restartElectron();
  });
  await watch(config.preload, () => {
    server.ws.send({ type: 'full-reload' });
  });
  await restartElectron();
} catch (error) {
  reportError(error);
  await shutdown(EXIT_ERROR);
}
