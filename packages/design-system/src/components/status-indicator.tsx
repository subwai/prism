import { Spinner } from '#components/spinner';
import { type ReactNode, useId } from 'react';

/**
 * Status text led by a spinner while work is in progress, and a quiet dot once idle. With
 * `details`, hovering or focusing it shows them, a line each, such as what the work is.
 */
export function StatusIndicator({
  busy,
  children,
  details,
}: {
  busy: boolean;
  children: ReactNode;
  details?: readonly string[];
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
        <ul
          id={hint}
          popover="hint"
          className="hint mb-1.5 [position-area:top_span-left] [position-try-fallbacks:flip-block]"
        >
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </>
  );
}
