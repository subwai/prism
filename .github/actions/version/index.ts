import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Manifest {
  name: string;
  version: string;
}

function manifest(): Manifest {
  return JSON.parse(fs.readFileSync('package.json', 'utf8'));
}

function previousVersion(fallback: string): string {
  try {
    const event: { before?: string } = JSON.parse(
        fs.readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
      ),
      previous: Manifest = JSON.parse(
        execFileSync('git', ['show', `${event.before ?? 'HEAD^'}:package.json`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      );
    return previous.version;
  } catch {
    return fallback;
  }
}

// Changesets' headings are fixed, so the release notes name them for people using the app.
const headings: Record<string, string> = {
  'Major Changes': 'Major changes',
  'Minor Changes': 'New',
  'Patch Changes': 'Improvements and fixes',
};

/** The changelog section for a version, without its version heading. */
function releaseNotes(changelog: string, version: string): string {
  const [, section = ''] = changelog.split(`\n## ${version}\n`),
    [body = ''] = section.split('\n## ');
  return `${body
    .replaceAll(
      /^### (?<heading>.+)$/gmu,
      (_line, heading: string): string => `### ${headings[heading] ?? heading}`,
    )
    .trim()}\n`;
}

function changeset(args: string[]): void {
  const cli = fileURLToPath(import.meta.resolve('@changesets/cli/bin.js'));
  execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
}

const app = manifest(),
  pending = fs
    .readdirSync('.changeset')
    .some((file): boolean => file.endsWith('.md') && file !== 'README.md'),
  prerelease = pending || app.version === previousVersion(app.version);

if (
  !process.env.GITHUB_OUTPUT ||
  !process.env.GITHUB_RUN_NUMBER ||
  !process.env.GITHUB_RUN_ATTEMPT
) {
  throw new Error('Run this version action inside GitHub Actions.');
}
if (prerelease) {
  // Main commits without a changeset still preview the next patch.
  if (!pending) {
    changeset(['--patch', app.name, '--message', 'Development snapshot']);
  }
  changeset([
    'version',
    '--snapshot',
    'next',
    '--snapshot-prerelease-template',
    `{tag}.${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT}`,
  ]);
}
const { version } = manifest(),
  notes = path.join(process.env.RUNNER_TEMP ?? '.', 'release-notes.md');
fs.writeFileSync(notes, releaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), version));
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  `version=${version}\nprerelease=${String(prerelease)}\nnotes=${notes}\n`,
);
