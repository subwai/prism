import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

function environment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

environment('CSC_LINK');
environment('CSC_KEY_PASSWORD');

const certificate = path.join(environment('RUNNER_TEMP'), 'electron-starter-test.cer');
writeFileSync(certificate, Buffer.from(environment('MAC_SELF_SIGNED_CERT'), 'base64'));
// Trust the test certificate only on this disposable macOS runner.
execFileSync(
  '/usr/bin/sudo',
  [
    '-n',
    '/usr/bin/security',
    'add-trusted-cert',
    '-d',
    '-r',
    'trustRoot',
    '-p',
    'codeSign',
    '-k',
    '/Library/Keychains/System.keychain',
    certificate,
  ],
  { stdio: 'inherit', timeout: 30_000 },
);
