import { EntryMenu } from '#components/entry-menu';
import { fakeAPI } from '#data/__tests__/fixtures';
import { LibrarySession } from '#data/library';
import { LibraryContext } from '#hooks/use-library';
import { startCommands } from '#keyboard/commands';
import { loadKeymap } from '#keyboard/keymap';
import { readKeybindings } from '@prism/keybindings';
import defaultKeybindings from '@prism/keybindings/default-keybindings.jsonc?raw';
import type { AppAPI } from '@prism/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { onTestFinished } from 'vitest';
import { render } from 'vitest-browser-react';
import '#style.css';

/** Unsubscribes from what the fake app never sends. */
function unsubscribe() {
  // Nothing to stop.
}

/** What the preload script gives the window on `platform`, with the photos answered by `photos`. */
function fakeApp(photos: AppAPI['photos'], platform: string): AppAPI {
  return {
    appearance: {
      getAccentColor: () => Promise.resolve(null),
      onAccentColorChange: () => unsubscribe,
    },
    debug: '',
    development: true,
    keybindings: {
      get: () =>
        Promise.resolve({
          defaults: readKeybindings(defaultKeybindings).rules,
          error: null,
          user: [],
        }),
      onChange: () => unsubscribe,
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
  ]);
  return { library, screen: await render(<Stub />) };
}
