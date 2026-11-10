import fs from 'node:fs';
import path from 'node:path';

// Changesets' headings are fixed, so the release notes name them for people using the app, each
// with an icon.
const headings: Record<string, string> = {
  'Major Changes': '💎 Major changes',
  'Minor Changes': '✨ New',
  'Patch Changes': '🔧 Improvements and fixes',
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

if (!process.env.GITHUB_OUTPUT) {
  throw new Error('Run this version action inside GitHub Actions.');
}
const { version }: { version: string } = JSON.parse(fs.readFileSync('package.json', 'utf8')),
  notes = path.join(process.env.RUNNER_TEMP ?? '.', 'release-notes.md');
fs.writeFileSync(notes, releaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), version));
fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnotes=${notes}\n`);
