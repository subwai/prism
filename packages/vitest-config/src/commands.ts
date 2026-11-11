import type { EmulatedMedia, MouseStep } from './browser.ts';
import type { BrowserCommand } from 'vitest/node';

/**
 * Playwright's mouse takes points on the whole page, which holds the test page in an iframe,
 * scaled down when it is larger than the window, so each point is moved and scaled to match.
 */
const mouse: BrowserCommand<[steps: MouseStep[]]> = async ({ iframe, page }, steps) => {
  const owner = iframe.owner();
  const box = await owner.boundingBox();
  if (!box) {
    throw new Error('The test page is not on screen.');
  }
  const scale = box.width / (await owner.evaluate((element) => element.clientWidth));
  for (const step of steps) {
    if ('move' in step) {
      await page.mouse.move(box.x + step.move.left * scale, box.y + step.move.top * scale, {
        steps: step.steps,
      });
    } else if ('down' in step) {
      await page.mouse.down();
    } else {
      await page.mouse.up();
    }
  }
};

const emulateMedia: BrowserCommand<[media: EmulatedMedia]> = ({ page }, media) =>
  page.emulateMedia(media);

export const commands = { emulateMedia, mouse };
