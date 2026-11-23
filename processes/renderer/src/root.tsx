import { loadAccentColor } from '#data/accent-color';
import { UPGRADING_LABEL, useCatalogUpgrading } from '#data/notices/catalog-upgrade';
import { startCommands } from '#keyboard/commands';
import { loadKeymap } from '#keyboard/keymap';
import type { Route } from '#types/root';
import { fontPreloads, LoadingScreen } from '@prism/design-system';
import { APP_NAME } from '@prism/shared';
import { type JSX, type ReactNode, useEffect } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import '#style.css';

export function meta(): Route.MetaDescriptors {
  return [{ title: APP_NAME }];
}

export function links(): Route.LinkDescriptors {
  return [...fontPreloads];
}

export function Layout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; img-src 'self' media: blob:; media-src media:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
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

// The keymap decides what keys and menus show, and the accent colours the controls, so both are
// read before the first frame.
export async function clientLoader() {
  await Promise.all([loadKeymap(), loadAccentColor()]);
  return null;
}

// Both follow their own changes once loaded, so navigating never needs to read them again.
export function shouldRevalidate() {
  return false;
}

// A launch reopens the last folder before the first frame, which waits while its catalog is
// upgraded.
export function HydrateFallback(): JSX.Element {
  return <LoadingScreen label={useCatalogUpgrading() ? UPGRADING_LABEL : undefined} />;
}

export default function App(): JSX.Element {
  useEffect(startCommands, []);
  return <Outlet />;
}
