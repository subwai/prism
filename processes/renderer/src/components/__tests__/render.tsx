import { diag, diagLog, fakeFolder, PHOTOS } from '#components/__tests__/fake-folder';
import { EntryMenu } from '#components/entry-menu';
import { fakeAPI } from '#data/__tests__/fixtures';
import { LibrarySession } from '#data/library';
import { rateEntry, ratingOf } from '#data/ratings';
import { openLibrary, requireLibrary } from '#data/session';
import { setViewerPreferences } from '#data/viewer-preferences';
import { LibraryContext } from '#hooks/use-library';
import { startCommands } from '#keyboard/commands';
import { loadKeymap } from '#keyboard/keymap';
import * as rootRoute from '#root';
import * as welcomeRoute from '#routes/_browser+/_index';
import * as browserRoute from '#routes/_browser+/_layout';
import * as libraryRoute from '#routes/_browser+/library+/_layout';
import * as filmstripRoute from '#routes/_browser+/library+/filmstrip';
import * as gridRoute from '#routes/_browser+/library+/grid';
import * as readerRoute from '#routes/_browser+/library+/reader';
import { readKeybindings } from '@prism/keybindings';
import defaultKeybindings from '@prism/keybindings/default-keybindings.jsonc?raw';
import type { AppAPI, KeybindingsState } from '@prism/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ComponentType, type ReactNode, useEffect } from 'react';
import { createRoutesStub, type NavigateFunction, useNavigate } from 'react-router';
import { onTestFailed, onTestFinished, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
// Declares the commands the component suite adds, such as `commands.mouse`.
import '@prism/vitest-config/browser';
import '#style.css';

/**
 * For the rest of the test, timeouts run in real time as before, but can also be moved on with
 * `vi.advanceTimersByTimeAsync`, so a test skips a delay such as the slideshow's rather than
 * waiting it out. Only timeouts: animation frames, media and Vitest's own retries keep real time.
 */
export function skippableTimers() {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

/** Unsubscribes from what the fake app never sends. */
function unsubscribe() {
  // Nothing to stop.
}

/** A window that goes full screen, or leaves it, as soon as it is asked to. */
function fakeFullScreen(): AppAPI['fullScreen'] {
  let fullScreen = false;
  return {
    onChange: () => unsubscribe,
    set(next) {
      const changed = next !== fullScreen;
      fullScreen = next;
      return Promise.resolve(changed);
    },
  };
}

const defaults = readKeybindings(defaultKeybindings).rules;
let keybindings: KeybindingsState = { defaults, error: null, user: [] };
// The keymap follows the first fake app it loads with for the page's session, so every fake
// app shares these.
const keybindingListeners = new Set<(state: KeybindingsState) => void>();

/**
 * Tells the window `keybindings.json` changed, as the main process does when it is saved: to
 * `user`'s rules, or with `error` if it no longer parses, keeping the rules it last read.
 */
export function saveKeybindings(user: unknown, error: string | null = null) {
  keybindings = { defaults, error, user: error === null ? user : keybindings.user };
  for (const listener of keybindingListeners) {
    listener(keybindings);
  }
}

/** What the preload script gives the window on `platform`, with the photos answered by `photos`. */
function fakeApp(photos: AppAPI['photos'], platform = 'darwin'): AppAPI {
  return {
    appearance: {
      getAccentColor: () => Promise.resolve(null),
      onAccentColorChange: () => unsubscribe,
    },
    debug: '',
    development: true,
    fullScreen: fakeFullScreen(),
    keybindings: {
      get: () => Promise.resolve(keybindings),
      onChange: (listener) => {
        keybindingListeners.add(listener);
        return () => keybindingListeners.delete(listener);
      },
      open: () => Promise.resolve(),
    },
    onCommand: () => unsubscribe,
    photos,
    platform,
  };
}

/**
 * Renders `ui` as the library route does, `width` by `height` pixels, in a library of the photos
 * `api` lists, with the keys working as they do in the app on `platform`. A `loader` runs on
 * every navigation, as the app's routes do, so changes to the URL can be made to wait on it.
 * Returns the library with the screen.
 */
export async function renderInLibrary(
  ui: ReactNode,
  {
    api = fakeAPI([]),
    width = 800,
    height = 600,
    platform = 'darwin',
    loader = undefined as (() => Promise<null>) | undefined,
  } = {},
) {
  globalThis.app = fakeApp(api, platform);
  await loadKeymap();
  saveKeybindings([]);
  onTestFinished(startCommands());
  const library = new LibrarySession(
    { id: '.', location: 'local', name: 'Pictures', session: 'test' },
    api,
  );
  onTestFinished(() => library.dispose());
  const Stub = createRoutesStub([
    {
      Component: () => (
        <QueryClientProvider client={library.queries}>
          <LibraryContext value={library}>
            <EntryMenu>
              <div className="flex flex-col" style={{ height, width }}>
                {ui}
              </div>
            </EntryMenu>
          </LibraryContext>
        </QueryClientProvider>
      ),
      loader,
      path: '/',
    },
    {
      // Ratings go through the library's action, as in the app.
      action: async ({ request }) => {
        const form = await request.formData();
        const entryId = String(form.get('entryId'));
        const result = await rateEntry(library, entryId, ratingOf(form.get('rating')));
        return 'error' in result ? result : { rated: result.entry };
      },
      path: '/library',
    },
  ]);
  return { library, screen: await render(<Stub />) };
}

type StubRoute = Parameters<typeof createRoutesStub>[0][number];

/**
 * A route as the app's route module defines it. The functions are the router's own, though
 * typed with the arguments React Router generates for the module rather than the stub's.
 */
function fromModule(
  module: {
    default: ComponentType<never>;
    clientLoader?: unknown;
    clientAction?: unknown;
    shouldRevalidate?: unknown;
    ErrorBoundary?: ComponentType<never>;
    HydrateFallback?: ComponentType<never>;
  },
  route: Partial<StubRoute> = {},
) {
  return {
    Component: module.default,
    ErrorBoundary: module.ErrorBoundary,
    HydrateFallback: module.HydrateFallback,
    action: module.clientAction,
    loader: module.clientLoader,
    shouldRevalidate: module.shouldRevalidate,
    ...route,
  } as StubRoute;
}

/** The window's size when the app first opens it. */
const WINDOW = { height: 780, width: 1180 };

/** How the test goes back and forward, as the router of the app last rendered does. */
const history: { navigate?: NavigateFunction } = {};

/** The root route's component, with its router's `navigate` kept for the test. */
function App() {
  const navigate = useNavigate();
  useEffect(() => {
    history.navigate = navigate;
  }, [navigate]);
  return <rootRoute.default />;
}

/** The app's routes, as `remix-flat-routes` lays out their files. */
const libraryRoutes = fromModule(libraryRoute, {
  children: [
    fromModule(gridRoute, { path: 'grid' }),
    fromModule(filmstripRoute, { path: 'filmstrip' }),
    fromModule(readerRoute, { path: 'reader' }),
  ],
  path: 'library',
});
const browserRoutes = fromModule(browserRoute, {
  children: [fromModule(welcomeRoute, { index: true }), libraryRoutes],
});
const AppStub = createRoutesStub([
  fromModule(rootRoute, { Component: App, children: [browserRoutes] }),
]);

// DIAG: when images load or fail, anywhere in the page.
for (const type of ['load', 'error'] as const) {
  document.addEventListener(
    type,
    (event) => {
      if (event.target instanceof HTMLImageElement) {
        diag(`img ${type} alt=${JSON.stringify(event.target.alt)} ${event.target.naturalWidth}x${event.target.naturalHeight} ${event.target.src.slice(0, 40)}`);
      }
    },
    true,
  );
}

/** DIAG: what the page shows, and what the fake folder was asked, when a test fails. */
function dumpOnFailure() {
  const start = performance.now();
  diagLog.length = 0;
  diag('test start');
  onTestFailed(() => {
    const images = [...document.querySelectorAll('img')].map((image) =>
      [
        `alt=${JSON.stringify(image.alt)}`,
        `complete=${image.complete}`,
        `natural=${image.naturalWidth}x${image.naturalHeight}`,
        `box=${Math.round(image.getBoundingClientRect().width)}x${Math.round(image.getBoundingClientRect().height)}`,
        `invisible=${Boolean(image.closest('.invisible'))}`,
        `inert=${Boolean(image.closest('[inert]'))}`,
        `src=${image.src.slice(0, 40)}`,
      ].join(' '),
    );
    console.log(
      [
        `DIAG failed after ${Math.round(performance.now() - start)}ms, now ${Math.round(performance.now())}`,
        `DIAG focus ${document.activeElement?.tagName} ${document.activeElement?.getAttribute('aria-label')}`,
        `DIAG animations ${document.getAnimations().length}`,
        ...images.map((line) => `DIAG img ${line}`),
        ...[...document.querySelectorAll('video')].map(
          (video) =>
            `DIAG video ${video.getAttribute('aria-label')} time=${video.currentTime} paused=${video.paused} duration=${video.duration} ready=${video.readyState}`,
        ),
        ...diagLog.map((line) => `DIAG log ${line}`),
      ].join('\n'),
    );
  });
}

/** Whether this file has rendered the app yet, so read what the window keeps in local storage. */
let started = false;

/**
 * Renders the app's own routes over `api`, by default the end-to-end tests' folder of photos,
 * in a page the size of the app's window, with the keys working as they do in the app. Unless
 * `open` is false, the folder is open and the grid showing; otherwise the welcome screen shows,
 * but only for a file's first test, as the folder stays open for the page's session.
 *
 * The window keeps its preferences in local storage, which every file's page shares, so a
 * file's first render starts from `saved` alone, as a launch with them saved does: each is the
 * JSON a store keeps under its key. Later renders keep the sizes the file's tests set, but open
 * photos fitted and videos unmuted at full volume. Returns the screen, the API to check what was asked of it,
 * and `navigate` to go back and forward.
 */
export async function renderApp({
  api = fakeFolder(PHOTOS),
  open = true,
  saved = {} as Record<string, object>,
} = {}) {
  if (started) {
    // Kept for as long as the window is open, which for a test is its whole file.
    setViewerPreferences({ fit: true, muted: false, volume: 1 });
  } else {
    started = true;
    localStorage.clear();
    for (const [key, value] of Object.entries(saved)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }
  dumpOnFailure();
  globalThis.app = fakeApp(api);
  // The root route loads the keymap, and starts the commands, as the app does.
  saveKeybindings([]);
  await page.viewport(WINDOW.width, WINDOW.height);
  if (open) {
    await openLibrary();
    onTestFinished(() => requireLibrary().close());
  }
  const screen = await render(<AppStub initialEntries={[open ? '/library/grid' : '/']} />);
  return {
    api,
    navigate: (delta: number) => history.navigate?.(delta),
    screen,
  };
}
