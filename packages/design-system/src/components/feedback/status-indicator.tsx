import { cn } from '#cn';
import { Spinner } from '#components/feedback/spinner';
import { type ReactNode, useId } from 'react';

/** A row of a status's details: a kind of work, what of it is under way, and how far it is. */
export interface StatusDetail {
  label: string;
  value: string;
  /** Whether it is under way; a row that is not shows dimmed, keeping its place. */
  active: boolean;
  /** How far it has got, from 0 to 1, as a bar under the row. */
  progress?: number;
}

/** The rows a status's hint shows, under `title`. */
function Details({ title, items }: { title: string; items: readonly StatusDetail[] }) {
  return (
    <>
      <p className="eyebrow mb-2">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map(({ active, label, progress, value }) => (
          <li key={label} className={cn('flex flex-col gap-1', !active && 'text-label-tertiary')}>
            <span className="flex items-baseline justify-between gap-4">
              <span>{label}</span>
              <span className={cn('truncate tabular-nums', active && 'text-label-secondary')}>
                {value}
              </span>
            </span>
            {progress !== undefined && (
              <progress className="progress-bar" value={progress} aria-label={label} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Status text led by a spinner while work is in progress, and a quiet dot once idle. With
 * `details`, hovering or focusing it shows them in a hint of a fixed size: every row always
 * there, in its place, so one can be followed as it changes.
 */
export function StatusIndicator({
  busy,
  children,
  details,
}: {
  busy: boolean;
  children: ReactNode;
  details?: { title: string; items: readonly StatusDetail[] };
}) {
  const hint = useId();
  const content = (
    <>
      {busy ? <Spinner size={11} /> : <span className="size-1.25 rounded-full bg-current" />}
      {children}
    </>
  );
  return (
    <>
      <span
        role="status"
        aria-busy={busy}
        className="text-label-secondary flex items-center gap-1.75 text-sm whitespace-nowrap"
      >
        {details ? (
          // Only a button or a link shows a hint as it is hovered or focused.
          <button
            type="button"
            // oxlint-disable-next-line react/no-unknown-property -- Interest invokers; typed in tooltip.tsx.
            interestfor={hint}
            className="rounded-control focus-visible:focus-ring flex cursor-default items-center gap-1.75"
          >
            {content}
          </button>
        ) : (
          content
        )}
      </span>
      {/*
       * Above, ending where the indicator ends, as it sits at the end of a bar at the bottom.
       * Outside the status, which would otherwise read out each change of what is running.
       */}
      {details && (
        <div
          id={hint}
          popover="hint"
          className="hint mb-1.5 w-80 px-3 py-2.5 [position-area:top_span-left] [position-try-fallbacks:flip-block]"
        >
          <Details title={details.title} items={details.items} />
        </div>
      )}
    </>
  );
}
