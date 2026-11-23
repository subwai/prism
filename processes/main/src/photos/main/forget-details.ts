import { sessionOf } from '#photos/main/sessions';
import type { Command } from '@prism/keybindings';
import { COMMAND_CHANNEL } from '@prism/shared';
import { BrowserWindow } from 'electron';

/**
 * Forgets every photo's details, through the catalog writer of `window`'s library, so its views
 * update as after any other write. Then every other window with a library refreshes. The catalog
 * file is shared, so the forget reached their photos too, but their own catalog threads didn't
 * make the write and can't tell the rows changed, so only a refresh shows it.
 */
export async function forgetPhotoDetails(window: BrowserWindow): Promise<void> {
  const session = sessionOf(window.webContents.id);
  if (!session) {
    return;
  }
  await session.client.call('forgetDetails');
  for (const other of BrowserWindow.getAllWindows()) {
    if (other !== window && !other.isDestroyed() && sessionOf(other.webContents.id)) {
      other.webContents.send(COMMAND_CHANNEL, 'refresh' satisfies Command);
    }
  }
}
