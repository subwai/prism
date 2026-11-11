import { countsLabel, DECISION_LABELS, reasonCounts, rowsOf } from '#data/trash';
import { useShortcutLabel } from '#keyboard/shortcuts';
import type { TrashChoices, TrashPlan, TrashReason, TrashRow } from '@prism/shared';
import type { ReactNode } from 'react';

function counted(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What this plan has of a kind of row: how many, and the first, by name, as an example. */
function inPlan(rows: TrashRow[], reason: TrashReason, extra = (_row: TrashRow) => '') {
  const of = rows.filter((row) => row.reason === reason);
  const [first] = of;
  if (!first) {
    return 'None in this plan.';
  }
  const example = `“${first.entry.name}”${extra(first)}`;
  return `${counted(of.length, 'row', 'rows')} in this plan, such as ${example}.`;
}

/** A decision as the text quotes it: `“Keep”`. */
function by(decision: keyof typeof DECISION_LABELS) {
  return `“${DECISION_LABELS[decision]}”`;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-semibold">{title}</h3>
      <p>{children}</p>
      {note && <p className="text-label-secondary text-sm">{note}</p>}
    </section>
  );
}

/**
 * How moving matches to the Trash works, told with this plan's own numbers and examples: what
 * matches, why each kind of row is there and how it is decided by default, the decisions, and
 * where everything goes.
 */
export function TrashExplainer({
  data,
  choices,
  narrowed,
  folderName,
}: {
  data: TrashPlan;
  choices: TrashChoices;
  narrowed: string;
  folderName: string;
}) {
  const key = useShortcutLabel();
  const rows = rowsOf(data);
  const counts = reasonCounts(rows);
  const sidecars = rows.reduce((total, row) => total + row.attachments.length, 0);
  const byHand = rows.filter((row) => row.changed).length;
  const keys = (['keep', 'only', 'rescue', 'trash'] as const)
    .map((command) => `${key(command) ?? '—'} ${DECISION_LABELS[command]}`)
    .join(', ');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 text-base">
      <Section
        title="What goes"
        note={`${counted(counts.matches, 'match', 'matches')} in this plan: ${countsLabel(data.totals)} to the Trash.`}
      >
        Everything inside “{folderName}”, at any depth, that matches {narrowed}, as the gallery
        would show it with the same search and filters. Folders match by their own rating and name.
      </Section>
      <Section
        title="A folder that matches goes whole"
        note={inPlan(
          rows.filter((row) => row.entry.kind === 'directory'),
          'matches',
          (row) => ` with ${countsLabel(row.contents)}`,
        )}
      >
        With everything inside it, rated or not. A folder’s rating never changes the ratings inside
        it. {by('only')} has only what inside it matches on its own go, and keeps the folder.
      </Section>
      <Section title="Rated, but its folder matches" note={inPlan(rows, 'conflict')}>
        Inside a matching folder, something rated that would not match on its own, as a safety net.
        It is {by(choices.defaults.conflict)} by default. {by('rescue')} moves it up out of the
        folder, so the folder can still go.
      </Section>
      <Section title="Matches, inside a folder kept" note={inPlan(rows, 'inside')}>
        What matches inside a folder you kept from the row above. It stays with that folder unless
        you say otherwise; by default it is {by(choices.defaults.inside)}.
      </Section>
      <Section title="Left empty" note={inPlan(rows, 'empty')}>
        A folder everything inside is leaving.{' '}
        {choices.defaults.empty === 'trash'
          ? 'By default it goes too.'
          : 'By default it stays, empty.'}{' '}
        Either way, what was inside it goes.
      </Section>
      <Section title="Keeps its folder from being left empty" note={inPlan(rows, 'leftover')}>
        A file nothing matches, such as a RAW file beside a JPEG, in a folder that would otherwise
        be left empty.{' '}
        {choices.defaults.leftover === 'keep'
          ? 'By default it stays, and so does its folder.'
          : 'By default it goes, and its folder with it.'}
      </Section>
      <Section
        title="Sidecars"
        note={`${counted(sidecars, 'sidecar', 'sidecars')} in this plan go or move with their photos.`}
      >
        .xmp and .aae files, and the ._ files macOS leaves on network shares, go with the photo or
        video they belong to, or move with it, and stay when it stays.
      </Section>
      <Section
        title="Defaults and decisions by hand"
        note={`${counted(byHand, 'row', 'rows')} decided by hand in this plan.`}
      >
        The switches at the top decide every row of their kind that you have not decided yourself. A
        row you decide shows a dot, and Reset takes it back to its default. Select rows by clicking
        them, with ⌘ one at a time or with Shift a range, or {key('selectAll') ?? '⌘A'} for every
        row shown, even through filters, then decide them all at once: {keys}.
      </Section>
      <Section title="Where everything goes">
        Nothing moves until you confirm. Everything goes to the Trash, never deleted outright, so
        you can put it back from there. On a network share without a Trash, Prism keeps its own
        Trash folder on the share. Files shows every file that goes, one by one.
      </Section>
    </div>
  );
}
