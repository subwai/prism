import { crxZip, unzip } from '#crx';
import {
  app,
  type Extension,
  type LoadExtensionOptions,
  net,
  session,
  type Session,
} from 'electron';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';

// The API of `electron-devtools-installer`, without its use of the deprecated `session`
// extension methods. Electron can load an unpacked extension but not fetch one, which is all
// this adds.

export interface ExtensionReference {
  /** The extension's Chrome Web Store ID. */
  id: string;
}

export interface InstallExtensionOptions {
  /** Download the extension again even if a copy is already kept. */
  forceDownload?: boolean;
  /** Options passed to `session.extensions.loadExtension`. */
  loadExtensionOptions?: LoadExtensionOptions;
  /** The session to install into; the default session if left out. */
  session?: Session;
}

/** The Chrome Web Store's download link, which redirects to the extension's CRX file. */
function storeURL(id: string): string {
  const url = new URL('https://clients2.google.com/service/update2/crx');
  url.searchParams.set('response', 'redirect');
  url.searchParams.set('acceptformat', 'crx3');
  url.searchParams.set('prodversion', process.versions.chrome);
  url.searchParams.set('x', `id=${id}&uc`);
  return url.href;
}

async function download(id: string, folder: string): Promise<void> {
  const response = await net.fetch(storeURL(id));
  if (!response.ok) {
    throw new Error(`The Chrome Web Store answered ${response.status} for ${id}`);
  }
  const zip = crxZip(Buffer.from(await response.arrayBuffer()));
  const partial = `${folder}.partial`;
  // Unpacked beside the folder and moved in whole, so an interrupted download is never loaded.
  await rm(partial, { force: true, recursive: true });
  await unzip(zip, partial);
  await rm(folder, { force: true, recursive: true });
  await rename(partial, folder);
}

async function installOne(
  reference: ExtensionReference | string,
  { forceDownload = false, loadExtensionOptions, session: target }: InstallExtensionOptions,
): Promise<Extension> {
  const id = typeof reference === 'string' ? reference : reference.id;
  const { extensions } = target ?? session.defaultSession;
  // Kept in the profile, as the original package does, and loaded from there on later runs.
  const folder = path.join(app.getPath('userData'), 'extensions', id);
  // Electron names an unpacked extension after its folder, not its store ID.
  const loaded = extensions.getAllExtensions().find((extension) => extension.path === folder);
  if (loaded && !forceDownload) {
    return loaded;
  }
  if (forceDownload || !existsSync(path.join(folder, 'manifest.json'))) {
    if (loaded) {
      extensions.removeExtension(loaded.id);
    }
    await download(id, folder);
  }
  return await extensions.loadExtension(folder, loadExtensionOptions);
}

/** Installs Chrome Web Store extensions, one after another, downloading each once. */
export async function installExtension(
  references: (ExtensionReference | string)[],
  options?: InstallExtensionOptions,
): Promise<Extension[]>;
export async function installExtension(
  reference: ExtensionReference | string,
  options?: InstallExtensionOptions,
): Promise<Extension>;
export async function installExtension(
  references: ExtensionReference | string | (ExtensionReference | string)[],
  options: InstallExtensionOptions = {},
): Promise<Extension | Extension[]> {
  if (!Array.isArray(references)) {
    return await installOne(references, options);
  }
  const installed: Extension[] = [];
  for (const reference of references) {
    installed.push(await installOne(reference, options));
  }
  return installed;
}

export const EMBER_INSPECTOR: ExtensionReference = { id: 'bmdblncegkenkacieihfhpjfppoconhi' };
export const REACT_DEVELOPER_TOOLS: ExtensionReference = { id: 'fmkadmapgofadopljbjfkapdkoienihi' };
export const BACKBONE_DEBUGGER: ExtensionReference = { id: 'bhljhndlimiafopmmhjlgfpnnchjjbhd' };
export const JQUERY_DEBUGGER: ExtensionReference = { id: 'dbhhnnnpaeobfddmlalhnehgclcmjimi' };
export const VUEJS_DEVTOOLS: ExtensionReference = { id: 'nhdogjmejiglipccpnnnanhbledajbpd' };
export const VUEJS_DEVTOOLS_BETA: ExtensionReference = { id: 'ljjemllljcmogpfapbkkighbhhppjdbg' };
export const REDUX_DEVTOOLS: ExtensionReference = { id: 'lmhkpmbekcpmknklioeibfkpmmfibljd' };
export const MOBX_DEVTOOLS: ExtensionReference = { id: 'pfgnfdagidkfgccljigdamigbcnndkod' };
