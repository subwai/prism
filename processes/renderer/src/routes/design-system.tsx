import { Buttons, Fields, Toolbars } from '#catalog/controls';
import { Feedback, Lists, Media, Overlays } from '#catalog/surfaces';
import { Tokens } from '#catalog/tokens';
import type { Route } from '#types/routes/+types/design-system';
import { Select, setAccentColor, Toolbar, Window } from '@prism/design-system';
import { useState } from 'react';
import { Link, replace } from 'react-router';

/*
 * A catalog of the design system: every token, and each component in the states it can be in,
 * for working on them and for the end-to-end screenshot tests. Not linked from the app; in
 * development, View > Design System opens it.
 */

export async function clientLoader() {
  // Only for development: a packaged app goes home instead of opening the catalog.
  if (!globalThis.app.development) {
    throw replace('/');
  }
  return { systemAccent: await globalThis.app.appearance.getAccentColor() };
}

/** Accents to try the theme with, as the system might give them. */
const ACCENTS = [
  { label: 'Blue (own)', value: 'own' },
  { label: 'Purple', value: '#bf5af2' },
  { label: 'Pink', value: '#ff375f' },
  { label: 'Red', value: '#ff453a' },
  { label: 'Orange', value: '#ff9f0a' },
  { label: 'Yellow', value: '#ffd60a' },
  { label: 'Green', value: '#30d158' },
  { label: 'Graphite', value: '#8e8e93' },
  { label: 'Navy', value: '#1f3a6e' }
];

/**
 * Tries the theme with other accents, as the system might give it, until the app reloads.
 * `System` says what it comes to, since with none, such as macOS's Multicolor, it is the own.
 */
function AccentPicker({ systemAccent }: { systemAccent: string | null }) {
  const [accent, setAccent] = useState('system');
  const system = systemAccent ? `System (${systemAccent.slice(0, 7)})` : 'System (Multicolor: own)';
  return (
    <Select
      label="Accent"
      showLabel
      value={accent}
      options={[{ label: system, value: 'system' }, ...ACCENTS]}
      onChange={(value) => {
        setAccent(value);
        if (value === 'system') {
          globalThis.app.appearance.getAccentColor().then(setAccentColor, () => null);
        } else {
          setAccentColor(value === 'own' ? null : value);
        }
      }}
    />
  );
}

export default function DesignSystem({ loaderData }: Route.ComponentProps) {
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
        <AccentPicker systemAccent={loaderData.systemAccent} />
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
