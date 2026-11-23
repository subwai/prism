import type { ElectronApplication } from 'playwright-core';

/**
 * Clicks the application menu's item `id` in the window, as the mouse would, with no key press
 * to count as a gesture. Returns the item's shortcut, so a test can check it too.
 */
export function clickMenuItem(app: ElectronApplication, id: string) {
  return app.evaluate(({ BrowserWindow, Menu }, item) => {
    const menuItem = Menu.getApplicationMenu()?.getMenuItemById(item);
    menuItem?.click(undefined, BrowserWindow.getAllWindows()[0]);
    return menuItem?.accelerator;
  }, id);
}
