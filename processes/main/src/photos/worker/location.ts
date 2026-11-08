import type { FolderLocation } from '@prism/shared';
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Linux's `statfs` magic numbers for network filesystems. FUSE is left out, since it serves
 * local disks as often as remote ones.
 */
const LINUX_NETWORK = new Set(
  Object.values({
    afs: 0x53_46_41_4f,
    ceph: 0x00_c3_64_00,
    cifs: 0xff_53_4d_42,
    coda: 0x73_75_72_45,
    nfs: 0x69_69,
    smb: 0x51_7b,
    smb2: 0xfe_53_4d_42,
    v9fs: 0x01_02_19_97,
  }),
);

/** A line of macOS's `mount`: `<device> on <mount point> (<type>, <flags>…)`. */
const MOUNT_LINE = /^.+ on (?<point>\/.*) \((?<flags>[^()]*)\)$/u;

/**
 * Whether `mount` lists the filesystem holding `folder` as local, the flag Finder's own
 * "is local" check reads. The deepest mount point holding the folder is the one it is on.
 */
export function isLocalMount(mounts: string, folder: string): boolean {
  let deepest: { point: string; local: boolean } | undefined;
  for (const line of mounts.split('\n')) {
    const groups = MOUNT_LINE.exec(line)?.groups;
    if (!groups?.point || !groups.flags) {
      continue;
    }
    const { point, flags } = groups;
    const holds = point === '/' || folder === point || folder.startsWith(`${point}/`);
    if (holds && point.length >= (deepest?.point.length ?? 0)) {
      deepest = { local: flags.split(', ').includes('local'), point };
    }
  }
  return deepest?.local ?? true;
}

/**
 * A UNC path such as `\\server\share`, which is where Windows' `realpath` resolves a mapped
 * network drive to. Device paths such as `\\?\Volume{…}` are local disks.
 */
export function isUNCPath(folder: string): boolean {
  return /^\\\\[^\\?.]/u.test(folder);
}

/**
 * Whether `folder`, a real path, is on this computer's disks or on a network share. Neither
 * Electron nor Node says, and `statfs` only names the filesystem on Linux: on macOS its type is
 * an index the system hands out as it loads filesystems. A folder whose disk cannot be told is
 * taken as local.
 */
export async function folderLocation(folder: string): Promise<FolderLocation> {
  try {
    if (process.platform === 'win32') {
      return isUNCPath(folder) ? 'network' : 'local';
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/sbin/mount');
      return isLocalMount(stdout, folder) ? 'local' : 'network';
    }
    return LINUX_NETWORK.has((await statfs(folder)).type) ? 'network' : 'local';
  } catch {
    return 'local';
  }
}
