import { Kbd, type Shortcut } from '#components/kbd';
import {
  loose,
  type Row,
  rowKey,
  sameRow,
  type SearchToken,
  type Section,
  sectionsOf,
  type TokenGroup,
  valuesOf,
} from '#components/token-search-rows';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';

export type { SearchToken, TokenGroup } from '#components/token-search-rows';

const ROW =
  'group rounded-control data-highlighted:bg-accent data-highlighted:text-on-accent flex items-center gap-1.5 py-1.5 pr-2.5 pl-2';
const COUNT =
  'text-label-tertiary group-data-highlighted:text-on-accent ml-auto pl-3 text-sm tabular-nums';

/**
 * A search field that also narrows by fields. What is typed is a free search, `query`. With
 * nothing typed, the list offers the fields of `groups`, and opening one lists its values in
 * place; typing lists the values of every field that match, under their fields. Choosing a value
 * adds it to `tokens` as a chip. Base UI's combobox provides the keys (arrows through the list,
 * Enter to choose, Backspace into the chips) and what screen readers are told.
 */
export function TokenSearchField({
  label,
  placeholder,
  shortcut,
  query,
  onQueryChange,
  tokens,
  onTokensChange,
  groups,
  empty,
  onFocus,
  onBlur,
}: {
  label: string;
  placeholder?: string;
  shortcut?: Shortcut;
  query: string;
  onQueryChange: (query: string) => void;
  tokens: SearchToken[];
  onTokensChange: (tokens: SearchToken[]) => void;
  groups: TokenGroup[];
  /** What the list says when nothing matches, such as while values are still being read. */
  empty: ReactNode;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const chips = useRef<HTMLDivElement>(null);
  const { contains } = Combobox.useFilter();
  // The field whose values the list shows, or `null` for the fields themselves.
  const [opened, setOpened] = useState<string | null>(null);
  const labels = new Map(groups.map((group) => [group.field, group.label]));
  const formats = new Map(groups.map((group) => [group.field, group.format]));
  const labelOf = (field: string) => labels.get(field) ?? field;
  const textOf = ({ field, value }: SearchToken) => formats.get(field)?.(value) ?? value;
  const describe = (token: SearchToken) => `${labelOf(token.field)}: ${textOf(token)}`;
  const open = groups.find((group) => group.field === opened);
  let items: Row[] | Section[];
  if (open) {
    const back: Row = { field: open.field, kind: 'back', label: open.label };
    // Base UI takes the list as all rows or all groups, so with sections the way back is one.
    items = open.section
      ? [{ items: [back], label: '' }, ...sectionsOf(open)]
      : [back, ...valuesOf(open)];
  } else if (query.trim()) {
    items = groups
      .map((group) => ({ items: valuesOf(group), label: group.label }))
      .filter((section) => section.items.length > 0);
  } else {
    // Only fields with values here, so with none the list says why instead.
    items = groups
      .filter((group) => group.values.length > 0)
      .map((group): Row => ({
        count: group.values.length,
        field: group.field,
        kind: 'field',
        label: group.label,
      }));
  }
  const values = tokens.map((token): Row => ({ ...token, count: 0, kind: 'value' }));
  function renderRow(row: Row) {
    if (row.kind === 'back') {
      return (
        <Combobox.Item key={rowKey(row)} value={row} className={ROW}>
          <ChevronLeft size={13} />
          <span className="eyebrow group-data-highlighted:text-on-accent">{row.label}</span>
        </Combobox.Item>
      );
    }
    if (row.kind === 'field') {
      return (
        <Combobox.Item key={rowKey(row)} value={row} className={ROW}>
          <span className="w-3.25" />
          <span className="truncate">{row.label}</span>
          <span className={COUNT}>{row.count}</span>
          <ChevronRight
            size={13}
            className="text-label-tertiary group-data-highlighted:text-on-accent"
          />
        </Combobox.Item>
      );
    }
    return (
      <Combobox.Item key={rowKey(row)} value={row} className={ROW}>
        <Check size={13} className="invisible group-data-selected:visible" />
        <span className="truncate">{textOf(row)}</span>
        <span className={COUNT}>{row.count}</span>
      </Combobox.Item>
    );
  }
  return (
    <Combobox.Root
      multiple
      items={items}
      value={values}
      onValueChange={(next) => {
        // Opening a field, or going back, is choosing its row; neither changes the chips.
        const step = next.find((row) => row.kind !== 'value');
        if (step) {
          setOpened(step.kind === 'field' ? step.field : null);
          return;
        }
        onTokensChange(
          next.flatMap((row) =>
            row.kind === 'value' ? [{ field: row.field, value: row.value }] : [],
          ),
        );
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setOpened(null);
        }
      }}
      inputValue={query}
      onInputValueChange={(next, details) => {
        // Base UI empties the input as its list closes, but here what is typed is the search, so
        // it stays until a suggestion chosen from it takes its place.
        if (details.reason !== 'input-clear' || details.isItemPress) {
          onQueryChange(next);
        }
      }}
      // Typing narrows values; the rows that open a field or go back stay.
      filter={(row: Row, text) =>
        row.kind !== 'value' ||
        contains(textOf(row), text) ||
        contains(loose(textOf(row)), loose(text))
      }
      isItemEqualToValue={sameRow}
      itemToStringLabel={(row) => (row.kind === 'value' ? textOf(row) : row.label)}
      autoHighlight
    >
      {/* The chips scroll sideways rather than wrap, since the toolbar is one line high. */}
      <Combobox.Chips
        ref={chips}
        className="no-drag rounded-field bg-fill text-label-tertiary has-focus-visible:focus-ring flex h-7 w-full scrollbar-none items-center gap-1 overflow-x-auto px-2.5"
      >
        <Search size={14} className="mr-0.75" />
        {tokens.map((token) => (
          <Combobox.Chip
            key={`${token.field}\n${token.value}`}
            aria-label={describe(token)}
            className="rounded-inner bg-fill-strong text-label flex h-5 items-center gap-0.5 pr-0.5 pl-1.5 text-sm whitespace-nowrap"
          >
            <span className="text-label-secondary">{labelOf(token.field)}</span>
            {textOf(token)}
            <Combobox.ChipRemove
              aria-label={`Remove ${describe(token)}`}
              className="text-label-secondary hover:bg-fill-selected hover:text-label flex size-4 items-center justify-center rounded-xs"
            >
              <X size={10} />
            </Combobox.ChipRemove>
          </Combobox.Chip>
        ))}
        {/* What typing narrows while a field is open; screen readers hear it with the list. */}
        {open && (
          <span aria-hidden className="text-label-secondary whitespace-nowrap">
            {open.label}:
          </span>
        )}
        <Combobox.Input
          aria-label={label}
          aria-keyshortcuts={shortcut?.keys}
          placeholder={tokens.length > 0 || open ? undefined : placeholder}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(event) => {
            // With nothing typed, Backspace leaves an open field before it removes chips.
            if (open && event.key === 'Backspace' && event.currentTarget.value === '') {
              event.preventBaseUIHandler();
              setOpened(null);
            }
          }}
          className="text-label placeholder:text-label-tertiary h-full min-w-12 flex-1 border-0 bg-transparent focus-visible:outline-none"
        />
        {/* Screen readers hear the shortcut with the field instead. */}
        {shortcut && tokens.length === 0 && !open && (
          <span aria-hidden>
            <Kbd>{shortcut.label}</Kbd>
          </span>
        )}
      </Combobox.Chips>
      <Combobox.Portal>
        <Combobox.Positioner anchor={chips} align="start" sideOffset={4} className="z-50">
          <Combobox.Popup className="material rounded-menu bg-menu/90 text-label max-h-80 w-(--anchor-width) min-w-56 overflow-y-auto p-1.5 text-base">
            {/* Says why there is nothing to choose, rather than the list not opening at all. */}
            <Combobox.Empty className="text-label-secondary px-2 py-1.5 empty:hidden">
              {empty}
            </Combobox.Empty>
            <Combobox.List>
              {(entry: Row | Section) =>
                'items' in entry ? (
                  <Combobox.Group
                    key={entry.items[0] ? rowKey(entry.items[0]) : entry.label}
                    items={entry.items}
                    className={
                      entry.label
                        ? 'not-first:mt-1.5'
                        : 'border-separator not-first:mt-1.5 not-first:border-t not-first:pt-1.5'
                    }
                  >
                    {entry.label && (
                      <Combobox.GroupLabel className="eyebrow px-2 pt-1.5 pb-1">
                        {entry.label}
                      </Combobox.GroupLabel>
                    )}
                    <Combobox.Collection>{(row: Row) => renderRow(row)}</Combobox.Collection>
                  </Combobox.Group>
                ) : (
                  renderRow(entry)
                )
              }
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
