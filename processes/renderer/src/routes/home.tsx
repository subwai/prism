import { APP_NAME } from '@app/shared';
import { type JSX, useState } from 'react';
import { Link } from 'react-router';

const ABOUT_LINK = 'About this starter →',
  DESCRIPTION = 'Three processes. Shared packages. Room for your idea.',
  EYEBROW = 'A SMALL PLACE TO START',
  PING_BUTTON = 'Ping main process';

export default function Home(): JSX.Element {
  const [reply, setReply] = useState('');

  async function ping(): Promise<void> {
    try {
      setReply(await globalThis.app.ping());
    } catch {
      setReply('Could not reach the main process.');
    }
  }

  return (
    <main>
      <p className="eyebrow">{EYEBROW}</p>
      <h1>{APP_NAME}</h1>
      <p>{DESCRIPTION}</p>
      <button type="button" onClick={ping}>
        {PING_BUTTON}
      </button>
      <output aria-live="polite">{reply}</output>
      <nav>
        <Link to="/about">{ABOUT_LINK}</Link>
      </nav>
    </main>
  );
}
