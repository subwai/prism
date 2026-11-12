import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const covering = (node: HTMLElement) => 'fullScreen' in node.dataset;

/**
 * Runs `update` as a view transition in which `node`, and the photo or video in it marked
 * `data-full-screen-media`, move from where they were to where they end up, each on its own.
 * The names are only given for the transition, so other view transitions, such as between
 * folders, leave them alone.
 */
async function transition(node: HTMLElement, update: () => void) {
  const media = node.querySelector<HTMLElement>('[data-full-screen-media]:not([inert] *)');
  node.style.viewTransitionName = 'full-screen';
  if (media) {
    media.style.viewTransitionName = 'full-screen-media';
  }
  try {
    await document.startViewTransition({ types: ['full-screen'], update: () => flushSync(update) })
      .finished;
  } finally {
    node.style.viewTransitionName = '';
    if (media) {
      media.style.viewTransitionName = '';
    }
  }
}

/** Waits for the next frame to be drawn. */
function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

/** How many frames the page's size has to hold, and how many to wait for that at most. */
const STEADY_FRAMES = 2;
const MOST_FRAMES = 12;

/**
 * Waits for the page to have drawn a few frames at one size, after the window has changed its
 * own: a view transition stops drawing while it takes its first picture, which, before then,
 * leaves the window showing nothing.
 */
async function settled() {
  let size = '';
  let steady = 0;
  for (let frame = 0; frame < MOST_FRAMES && steady < STEADY_FRAMES; frame += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one frame after another.
    await nextFrame();
    const now = `${innerWidth}x${innerHeight}`;
    steady = now === size ? steady + 1 : 0;
    size = now;
  }
}

/**
 * Puts the element `ref` is attached to on its own across the screen, and brings it back. It
 * marks the element `data-full-screen`, which the `fullscreen:` variant styles.
 *
 * The element grows from its place to cover the window, in the top layer as a popover, and
 * only then does the window go full screen, into a Space of its own, so the window's transition
 * carries nothing but the element. Leaving, the window comes back first, and the element then
 * shrinks back into its place. The Fullscreen API instead restyled the element in a jump after
 * the window's transition, which carried the whole app.
 */
export function useFullScreen() {
  const [fullScreen, setFullScreen] = useState(false);
  const element = useRef<HTMLElement>(null);
  // Whether the window went full screen for the element, rather than already being so, as its
  // green button leaves it; only then does leaving take the window back out.
  const entering = useRef(Promise.resolve(false));
  // A press while the element moves waits for it to settle, then turns it back.
  const moving = useRef<Promise<unknown>>(Promise.resolve());
  // Keys go where focus is, so it moves into the element from whatever the element covers,
  // and goes back on leaving.
  const returnTo = useRef<Element | null>(null);

  function cover(node: HTMLElement) {
    returnTo.current = document.activeElement;
    node.popover = 'manual';
    node.showPopover();
    node.dataset.fullScreen = '';
    setFullScreen(true);
    if (!node.contains(returnTo.current)) {
      node.focus({ preventScroll: true });
    }
  }
  function uncover(node: HTMLElement) {
    if (!covering(node)) {
      return;
    }
    const focused = document.activeElement;
    node.hidePopover();
    node.removeAttribute('popover');
    delete node.dataset.fullScreen;
    setFullScreen(false);
    const back = returnTo.current;
    const lost = focused === null || focused === document.body;
    if (back instanceof HTMLElement && back.isConnected && !node.contains(back)) {
      if (lost || node.contains(focused)) {
        back.focus({ preventScroll: true });
      }
    } else if (lost && node.isConnected) {
      node.focus({ preventScroll: true });
    }
  }
  /** Leaves the window as it was, and then, if `animate`, moves the element back into place. */
  async function leave(node: HTMLElement, animate = true) {
    const owned = await entering.current;
    entering.current = Promise.resolve(false);
    // Resolves once the window is back, which takes its transition.
    if (owned && (await globalThis.app.fullScreen.set(false)) && animate) {
      await settled();
    }
    if (animate && node.isConnected) {
      await transition(node, () => uncover(node));
    } else {
      uncover(node);
    }
  }
  async function enter(node: HTMLElement) {
    await transition(node, () => cover(node));
    // The window's transition starts from a picture of it, which must show the element over it.
    await nextFrame();
    entering.current = globalThis.app.fullScreen.set(true);
  }

  const ref = (node: HTMLElement) => {
    element.current = node;
    // However else the window leaves full screen, as from its green button, the element comes
    // back with it.
    const unsubscribe = globalThis.app.fullScreen.onChange((windowFullScreen) => {
      if (!windowFullScreen) {
        entering.current = Promise.resolve(false);
        uncover(node);
      }
    });
    // Escape leaves full screen, as in a browser, and does nothing else: a sheet the element
    // sits in stays open.
    function leaveOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && covering(node)) {
        event.preventDefault();
        toggle();
      }
    }
    globalThis.addEventListener('keydown', leaveOnEscape);
    return () => {
      element.current = null;
      unsubscribe();
      globalThis.removeEventListener('keydown', leaveOnEscape);
      // React detaches the ref on every new one it is given, as well as on unmounting, so this
      // waits to see whether the element went before taking the window back out.
      queueMicrotask(() => {
        if (!node.isConnected && covering(node)) {
          leave(node, false);
        }
      });
    };
  };
  function toggle() {
    // A move that fails, as when the window cannot change, leaves the next press to try again.
    moving.current = moving.current
      .then(() => {
        const node = element.current;
        return node && (covering(node) ? leave(node) : enter(node));
      })
      .catch(() => null);
  }
  return { fullScreen, ref, toggle };
}
