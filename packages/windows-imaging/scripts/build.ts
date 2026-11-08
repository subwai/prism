import { spawnSync } from 'node:child_process';

// The addon is Windows' own: elsewhere the photo worker converts HEIF photos with the system's
// tools. So it builds on Windows only, and working on Prism elsewhere needs no Rust. Turbo has
// no per-platform tasks, which is why this is a script rather than the command itself.
if (process.platform === 'win32') {
  // Through the shell, which finds pnpm's `napi` script on Windows.
  const { status } = spawnSync('napi build --platform --release --no-js', {
    shell: true,
    stdio: 'inherit',
  });
  process.exitCode = status ?? 1;
}
