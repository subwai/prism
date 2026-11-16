import { renderInLibrary } from '#components/__tests__/render';
import { Collection } from '#components/collection';
import { fakeAPI, tellView } from '#data/__tests__/fixtures';
import type { ViewMode } from '#data/entries';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { Suspense, use, useState } from 'react';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

// Views longer than Chromium lets an element get, which the collection's scroller is capped
// short of.

const HUGE = 2_000_000;
const hugeName = (index: number) => `IMG_${String(index).padStart(7, '0')}.jpg`;

function photoAt(index: number): PhotoEntry {
  const name = hugeName(index);
  return { id: name, kind: 'image', name, parentId: '.' };
}

/**
 * The root's photos in a grid, or `mode`, with the selection kept as the grid view keeps it,
 * in cards that grow as the button is pressed.
 */
function Root({ mode }: { mode: ViewMode }) {
  const library = useLibrary();
  const view = use(library.view(folderSpec('.')));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grown, setGrown] = useState(false);
  const size = mode === 'filmstrip' ? 76 : 170;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button type="button" onClick={() => setGrown(true)}>
        Grow
      </button>
      <Collection
        view={view}
        selectedId={selectedId}
        onSelect={(entry) => setSelectedId(entry.id)}
        size={grown ? size * 2 : size}
        mode={mode}
      />
    </div>
  );
}

async function renderHuge(mode: ViewMode = 'grid') {
  const api = hugeAPI();
  const { screen } = await renderInLibrary(
    <Suspense>
      <Root mode={mode} />
    </Suspense>,
    { api, height: mode === 'filmstrip' ? 240 : 600 },
  );
  return { api, list: screen.getByRole('listbox').element(), screen };
}

/** A view of `HUGE` photos, made as they are read, longer than any element can get. */
function hugeAPI() {
  const api = fakeAPI([]);
  const opened = api.openView.getMockImplementation();
  api.openView.mockImplementation(async (spec) => ({
    ...(await (opened?.(spec) ?? Promise.reject(new Error('No view.')))),
    count: HUGE,
  }));
  api.viewRows.mockImplementation((_viewId, _version, start, count) => {
    const length = Math.max(0, Math.min(count, HUGE - start));
    return Promise.resolve(Array.from({ length }, (_photo, offset) => photoAt(start + offset)));
  });
  api.viewIndexOf.mockImplementation((_viewId, _version, id) =>
    Promise.resolve(Number(id.slice(4, 11))),
  );
  return api;
}

/** Where among all the entries the options rendered fall, from the first to the last. */
function positions(list: Element) {
  const options = [...list.querySelectorAll('[role="option"]')];
  return options.map((option) => Number(option.getAttribute('aria-posinset')));
}

/** Whether the option named `name`, or else the selected one, shows whole in `list`. */
function shownWhole(list: Element, name?: string) {
  const option = list.querySelector(name ? `[aria-label="${name}"]` : '[aria-selected="true"]');
  const box = option?.getBoundingClientRect();
  const edges = list.getBoundingClientRect();
  return (
    box !== undefined &&
    box.left >= edges.left &&
    box.right <= edges.right &&
    box.top >= edges.top &&
    box.bottom <= edges.bottom
  );
}

describe.each(['grid', 'filmstrip'] as const)('a %s of two million entries', (mode) => {
  test('scrolls to its end, and to its middle, though its scroller is capped', async () => {
    const { list } = await renderHuge(mode);
    await expect.poll(() => shownWhole(list, hugeName(0))).toBe(true);
    // Chromium stops an element growing at 16,777,216 px.
    expect(Math.max(list.scrollWidth, list.scrollHeight)).toBeLessThan(16_777_216);

    list.scrollTo({ left: list.scrollWidth, top: list.scrollHeight });
    await expect.poll(() => shownWhole(list, hugeName(HUGE - 1))).toBe(true);

    // As a drag of the scrollbar to its middle does.
    list.scrollTo({
      left: (list.scrollWidth - list.clientWidth) / 2,
      top: (list.scrollHeight - list.clientHeight) / 2,
    });
    await expect.poll(() => positions(list)[0]).toBeLessThan(HUGE / 2);
    expect(positions(list).at(-1)).toBeGreaterThan(HUGE / 2);
  });

  test('End and Home select and show its last and first entries', async () => {
    const { list, screen } = await renderHuge(mode);
    await screen.getByRole('option', { name: hugeName(0) }).click();
    await userEvent.keyboard('{End}');
    const last = screen.getByRole('option', { name: hugeName(HUGE - 1) });
    await expect.element(last).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => shownWhole(list, hugeName(HUGE - 1))).toBe(true);

    // One back, then home again.
    await userEvent.keyboard(mode === 'grid' ? '{ArrowUp}' : '{ArrowLeft}');
    await expect.element(last).toHaveAttribute('aria-selected', 'false');
    await expect.poll(() => shownWhole(list)).toBe(true);
    await userEvent.keyboard('{Home}');
    const first = screen.getByRole('option', { name: hugeName(0) });
    await expect.element(first).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => shownWhole(list, hugeName(0))).toBe(true);
  });
});

/** The name of the card nearest the middle of the filmstrip, gaps and all. */
function nearestMiddle(strip: Element) {
  const box = strip.getBoundingClientRect();
  const middle = box.left + box.width / 2;
  const away = (option: Element) => {
    const { left, right } = option.getBoundingClientRect();
    return Math.abs((left + right) / 2 - middle);
  };
  const options = [...strip.querySelectorAll('[role="option"]')];
  return options.toSorted((one, other) => away(one) - away(other))[0]?.getAttribute('aria-label');
}

test('a growing filmstrip of two million entries keeps the card in its middle there', async () => {
  const { list, screen } = await renderHuge('filmstrip');
  await expect.poll(() => shownWhole(list, hugeName(0))).toBe(true);
  list.scrollLeft = (list.scrollWidth - list.clientWidth) / 2;
  await expect.poll(() => positions(list)[0]).toBeGreaterThan(HUGE / 4);
  const middle = nearestMiddle(list);
  await screen.getByRole('button', { name: 'Grow' }).click();
  await expect.poll(() => list.querySelector('[role="option"]')?.clientWidth).toBe(152);
  await expect.poll(() => nearestMiddle(list)).toBe(middle);
});

test('a grid of two million entries stays where it is as more arrive', async () => {
  const { api, list, screen } = await renderHuge();
  await expect.poll(() => shownWhole(list, hugeName(0))).toBe(true);
  list.scrollTop = (list.scrollHeight - list.clientHeight) / 2;
  await expect.poll(() => positions(list)[0]).toBeGreaterThan(HUGE / 4);
  const shown = positions(list)
    .map((position) => hugeName(position - 1))
    .find((name) => shownWhole(list, name));
  const [state] = await Promise.all(api.openView.mock.results.map(({ value }) => value));
  if (state) {
    tellView(api, { ...state, count: HUGE * 2, version: 2 });
  }
  await expect
    .element(screen.getByRole('option').first())
    .toHaveAttribute('aria-setsize', `${HUGE * 2}`);
  expect(shown && shownWhole(list, shown)).toBe(true);
});
