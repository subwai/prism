import { Toolbar, Window } from '@prism/design-system';
import {
  Buttons,
  Feedback,
  Fields,
  Lists,
  Media,
  Overlays,
  Tokens,
  Toolbars,
} from '@prism/design-system/catalog';
import { Link, replace } from 'react-router';

/*
 * A catalog of the design system: every token, and each component in the states it can be in,
 * for working on them and for the end-to-end screenshot tests. Not linked from the app; in
 * development, View > Design System opens it.
 */

export function clientLoader() {
  // Only for development: a packaged app goes home instead of opening the catalog.
  if (!globalThis.app.development) {
    throw replace('/');
  }
  return null;
}

export default function DesignSystem() {
  return (
    <Window className="bg-window select-text">
      <Toolbar>
        {/* Clear of the window controls, where the platform draws them over the page. */}
        <span className="w-traffic-lights shrink-0" />
        <Link
          to="/"
          className="rounded-control text-label-secondary hover:bg-fill px-2 py-1 text-sm"
        >
          ← Back
        </Link>
        <h1 className="text-md flex-1 font-semibold">Design system</h1>
      </Toolbar>
      <main className="min-h-0 flex-1 overflow-auto">
        <Tokens />
        <Buttons />
        <Fields />
        <Toolbars />
        <Lists />
        <Feedback />
        <Media />
        <Overlays />
      </main>
    </Window>
  );
}
