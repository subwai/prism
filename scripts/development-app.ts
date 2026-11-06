import electronPath from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// Development runs would otherwise show as Electron, with its icon, in the Dock, the menu bar and
// Activity Monitor. On macOS they run from a copy of Electron.app named and drawn as Prism, which
// electron-builder makes for packaged builds but neither Electron nor electron-vite offers in
// development. The main executable keeps its name: Electron reports itself as packaged unless it
// is called `Electron`. Other platforms take their names from the executable, so they run the
// stock one.
const NAME = 'Prism',
  BUNDLE_ID = 'com.subwai.prism.development',
  // Electron finds its helpers by the bundle's name once no `Electron Helper` remains.
  HELPER = 'Electron Helper',
  ICON_SIZES = [16, 32, 128, 256, 512],
  root = path.resolve(import.meta.dirname, '..'),
  icon = path.join(root, 'resources/icon-mac.png'),
  output = path.join(root, 'out/development'),
  bundle = path.join(output, `${NAME}.app`),
  stamp = path.join(output, 'stamp'),
  run = promisify(execFile);

// One at a time, as each rewrites the whole file.
async function plist(file: string, values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    // oxlint-disable-next-line no-await-in-loop -- concurrent writes would race.
    await run('plutil', ['-replace', key, '-string', value, file]);
  }
}

// The `.icns` an app bundle needs, from the macOS icon electron-builder packages.
async function writeIcon(file: string): Promise<void> {
  const iconset = path.join(output, `${NAME}.iconset`);
  await mkdir(iconset, { recursive: true });
  await Promise.all(
    ICON_SIZES.flatMap((size) => [
      run('sips', [
        '-z',
        `${size}`,
        `${size}`,
        icon,
        '--out',
        path.join(iconset, `icon_${size}x${size}.png`),
      ]),
      run('sips', [
        '-z',
        `${size * 2}`,
        `${size * 2}`,
        icon,
        '--out',
        path.join(iconset, `icon_${size}x${size}@2x.png`),
      ]),
    ]),
  );
  await run('iconutil', ['--convert', 'icns', iconset, '--output', file]);
  await rm(iconset, { recursive: true });
}

async function renameHelpers(frameworks: string): Promise<void> {
  const helpers = (await readdir(frameworks)).filter((entry) => entry.startsWith(HELPER));
  await Promise.all(
    helpers.map(async (entry) => {
      const helper = path.basename(entry, '.app'),
        renamed = helper.replace(HELPER, `${NAME} Helper`),
        contents = path.join(frameworks, `${renamed}.app`, 'Contents');
      await rename(path.join(frameworks, entry), path.join(frameworks, `${renamed}.app`));
      await rename(path.join(contents, 'MacOS', helper), path.join(contents, 'MacOS', renamed));
      await plist(path.join(contents, 'Info.plist'), {
        CFBundleExecutable: renamed,
        CFBundleName: renamed,
      });
    }),
  );
}

async function build(source: string): Promise<void> {
  const contents = path.join(bundle, 'Contents');
  await rm(bundle, { force: true, recursive: true });
  await mkdir(output, { recursive: true });
  // A clone on APFS, so the copy costs no time or space.
  await cp(source, bundle, {
    mode: constants.COPYFILE_FICLONE,
    recursive: true,
    verbatimSymlinks: true,
  });
  await rm(path.join(contents, 'Resources/electron.icns'));
  await writeIcon(path.join(contents, 'Resources', `${NAME}.icns`));
  await plist(path.join(contents, 'Info.plist'), {
    CFBundleDisplayName: NAME,
    CFBundleIconFile: `${NAME}.icns`,
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleName: NAME,
  });
  await renameHelpers(path.join(contents, 'Frameworks'));
}

/** The executable development runs launch: Electron's own, or on macOS a copy named Prism. */
export async function developmentExecutable(): Promise<string> {
  const executable = electronPath as unknown as string;
  if (process.platform !== 'darwin') {
    return executable;
  }
  const source = path.resolve(executable, '../../..'),
    key = createHash('sha256')
      .update(source)
      .update(await readFile(path.join(source, 'Contents/Info.plist')))
      .update(await readFile(icon))
      .update(await readFile(import.meta.filename))
      .digest('hex');
  const built = await readFile(stamp, 'utf8').catch(() => '');
  if (built !== key) {
    await build(source);
    await writeFile(stamp, key);
  }
  return path.join(bundle, 'Contents/MacOS', path.basename(executable));
}
