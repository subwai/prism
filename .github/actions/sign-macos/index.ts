import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function environment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set the ${name} repository secret for self-signed macOS builds.`);
  }
  return value;
}

environment('CSC_LINK');
environment('CSC_KEY_PASSWORD');

const certificate = path.join(environment('RUNNER_TEMP'), 'electron-starter-test.cer');
writeFileSync(certificate, Buffer.from(environment('MAC_SELF_SIGNED_CERT'), 'base64'));
// Trust the test certificate only on this disposable macOS runner.
execFileSync(
  '/usr/bin/security',
  [
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'codeSign',
    '-k',
    path.join(homedir(), 'Library/Keychains/login.keychain-db'),
    certificate
  ],
  { stdio: 'inherit' }
);
