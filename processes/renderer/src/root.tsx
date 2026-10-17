import type { Route } from '#types/root';
import { LoadingScreen } from '@app/design-system';
import { APP_NAME } from '@app/shared';
import type { JSX, ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import '#style.css';

export function meta(): Route.MetaDescriptors {
  return [{ title: APP_NAME }];
}

export function Layout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; img-src 'self' media:; media-src media:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback(): JSX.Element {
  return <LoadingScreen />;
}

export default function App(): JSX.Element {
  return <Outlet />;
}
