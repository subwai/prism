import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Runs `command` through the shell, which finds pnpm's `napi` script on Windows. */
function run(command: string) {
  const { status } = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (status !== 0) {
    throw new Error(`${command} failed with ${status}.`);
  }
}

if (process.platform === 'darwin') {
  // One addon for both kinds of Mac, as the app is built for each from the same checkout.
  const targets = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  for (const target of targets) {
    run(`napi build --platform --release --no-js --target ${target}`);
  }
  const built = ['trash.darwin-arm64.node', 'trash.darwin-x64.node'];
  run(`lipo -create ${built.join(' ')} -output trash.darwin-universal.node`);
  // Only the one the app ships.
  for (const file of built) {
    rmSync(file);
  }
} else {
  run('napi build --platform --release --no-js');
}
