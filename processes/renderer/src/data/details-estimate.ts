// The rate photos' details are read at is their count over this long, so the time left follows
// how fast reading goes now, not a moment's burst or stall.
const RATE_WINDOW_MS = 5 * 60_000;
// Until reading has been seen for this long, there is too little to go on for a time left.
const LEAST_SPAN_MS = 30_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** How many photos had their details read, as heard at `ms`. */
export interface DetailsSample {
  ms: number;
  read: number;
}

/** `samples` with `sample` added, less those too old to count towards the rate. */
export function withSample(samples: DetailsSample[], sample: DetailsSample): DetailsSample[] {
  return [...samples.filter(({ ms }) => ms > sample.ms - RATE_WINDOW_MS), sample];
}

/**
 * How long reading the details of `left` photos more takes at the rate `samples` show, or `null`
 * while they span too short a time, or show none read.
 */
export function msLeft(samples: DetailsSample[], left: number): number | null {
  const first = samples.at(0);
  const last = samples.at(-1);
  if (!first || !last || last.ms - first.ms < LEAST_SPAN_MS) {
    return null;
  }
  const perMs = (last.read - first.read) / (last.ms - first.ms);
  return perMs > 0 ? left / perMs : null;
}

/** A time left in words, rounded so that it reads at a glance and changes seldom. */
export function timeLeft(ms: number): string {
  if (ms < MINUTE_MS) {
    return 'under a minute left';
  }
  if (ms < HOUR_MS) {
    return `about ${Math.round(ms / MINUTE_MS)} min left`;
  }
  if (ms < 48 * HOUR_MS) {
    return `about ${Math.round(ms / HOUR_MS)} h left`;
  }
  return `about ${Math.round(ms / (24 * HOUR_MS))} days left`;
}
