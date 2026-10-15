import type { Route } from '#types/routes/+types/about';
import type { JSX } from 'react';
import { Link } from 'react-router';

const BACK_LINK = '← Back home',
  DESCRIPTION = 'Route modules, typed data, and Fast Refresh inside Electron.',
  EYEBROW = 'REACT ROUTER · FRAMEWORK MODE',
  HEADING = 'Ready to make it yours',
  REPLY_LABEL = 'Main process says: ';

export async function clientLoader(): Promise<{ reply: string }> {
  return { reply: await globalThis.app.ping() };
}

export default function About({ loaderData }: Route.ComponentProps): JSX.Element {
  return (
    <main>
      <p className="eyebrow">{EYEBROW}</p>
      <h1>{HEADING}</h1>
      <p>{DESCRIPTION}</p>
      <p>
        {REPLY_LABEL}
        {loaderData.reply}
      </p>
      <nav>
        <Link to="/">{BACK_LINK}</Link>
      </nav>
    </main>
  );
}
