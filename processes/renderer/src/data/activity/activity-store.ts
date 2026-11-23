import { type DetailsSample, msLeft, withSample } from '#data/activity/details-estimate';
import type { Activity } from '@prism/shared';
import { useSyncExternalStore } from 'react';

const MINUTE_MS = 60_000;

/** What the worker last reported it is busy with, and how long reading photos' details has left. */
export interface ReportedActivity {
  activity: Activity;
  detailsLeft: number | null;
}

/** What the open folder's worker last reported; `null` until it reports. */
let latest: ReportedActivity | null = null;
/** How many photos had their details read at each recent report, for working out the rate. */
let samples: DetailsSample[] = [];
const listeners = new Set<() => void>();
let stopListening: (() => void) | undefined;

function receiveActivity(activity: Activity) {
  const { details } = activity;
  if (details) {
    samples = withSample(samples, { ms: Date.now(), read: details.read });
  }
  latest = { activity, detailsLeft: details && msLeft(samples, details.photos - details.read) };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  if (!stopListening) {
    // What came before may be about another folder. The worker's bridge sends it again.
    latest = null;
    samples = [];
    stopListening = globalThis.app.photos.onActivity(receiveActivity);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

/**
 * Whether the open folder's share is offline, as its worker last reported. While it is,
 * everything shown comes from the catalog. It changes rarely, so components that read it render
 * again only when it changes, not with every change in the work under way.
 */
export function useShareOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => latest?.activity.offline ?? false,
    () => false,
  );
}

/**
 * What the open folder's worker is busy with, as it last reported, and how long reading photos'
 * details has left at the recent rate. Only the status bar's indicator reads it, so nothing else
 * renders again as it changes. The build prerenders without it.
 */
export function useActivity(): ReportedActivity | null {
  return useSyncExternalStore(
    subscribe,
    () => latest,
    () => null,
  );
}

/** Calls `listener` once a minute. */
function everyMinute(listener: () => void) {
  const timer = setInterval(listener, MINUTE_MS);
  return () => clearInterval(timer);
}

/**
 * The time now, rounded down to the minute, which moves on once a minute. The worker sends only
 * what changes, so without this "checked 5 min ago" would stay stuck while nothing else changes.
 * The build prerenders at 0.
 */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    everyMinute,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => 0,
  );
}
