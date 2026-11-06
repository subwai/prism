import { developmentExecutable } from './development-app.ts';
import { spawn } from 'node:child_process';

// Opens the production build in the same Prism-named Electron as the dev runner.
const child = spawn(await developmentExecutable(), ['.'], { stdio: 'inherit' });
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
