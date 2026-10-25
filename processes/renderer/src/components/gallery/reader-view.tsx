import { useEntryMenu, useEntryMenuBelow, useRenameEntry } from '#components/entry-menu';
import {
  EmptyCollection,
  type GalleryData,
  GalleryFrame,
  useArrangedEntries,
  useScan
} from '#components/gallery/gallery-frame';
import { Page, pageAt, scrollPages } from '#components/gallery/reader-page';
import { usePageWidth } from '#components/gallery/use-thumbnail-size';
import { useFullScreen } from '#components/viewer/use-full-screen';
import { useIdlePointer } from '#components/viewer/use-idle-pointer';
import { useSlideshowTimer } from '#components/viewer/use-slideshow-timer';
import { ViewerAnnouncement } from '#components/viewer/viewer-announcement';
import { ViewerToolbar } from '#components/viewer/viewer-toolbar';
import { useViewParams } from '#hooks/use-view-params';
import { useCommands } from '#keyboard/commands';
import { FloatingControls, mergeRefs } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The pages, one below the other at `width` or the window's, whichever is narrower, scrolling
 * as a web page does: Up, Down, Space and Page Up and Down scroll, while Left and Right turn to
 * the page before or after, as a slideshow does a page at a time. Nothing is selected; `onPage`
 * hears which page is at the top. Like the viewer, it goes full screen, with its controls and
 * the pointer hiding while the pointer rests.
 */
function Pages({
  entries,
  width,
  onPage
}: {
  entries: PhotoEntry[];
  width: number;
  onPage: (index: number) => void;
}) {
  const showEntryMenu = useEntryMenu();
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  const scroller = useRef<HTMLElement | null>(null);
  const [available, setAvailable] = useState(0);
  const column = Math.min(width, available);
  // A page turned to while the last turn still scrolls, so quick presses each turn one more.
  const turning = useRef<number | null>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    // As tall as `--aspect-page` until measured.
    estimateSize: () => column * Math.SQRT2,
    getItemKey: (index) => entries[index]?.id ?? index,
    getScrollElement: () => scroller.current,
    onChange(instance) {
      if (!instance.isScrolling) {
        turning.current = null;
      }
      onPage(pageAt(instance));
    },
    overscan: 2,
    scrollToFn: scrollPages
  });
  const page = pageAt(virtualizer);
  // Content that loads into a view that replaced the one with focus, as going to another
  // folder from the toolbar does, takes it, so the keys work at once; see the collection.
  // Measured while committing, so the first frame already lays pages out at their width.
  const attach = useCallback((node: HTMLElement) => {
    scroller.current = node;
    if (document.activeElement === document.body) {
      node.focus();
    }
    setAvailable(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => {
      observer.disconnect();
      scroller.current = null;
    };
  }, []);
  // Pages laid out at the old width keep its height until the virtualizer forgets it; the
  // page at the top stays there.
  useEffect(() => {
    const top = pageAt(virtualizer);
    virtualizer.measure();
    virtualizer.scrollToIndex(top, { align: 'start' });
  }, [virtualizer, column]);
  function turn(offset: 1 | -1) {
    const offsetTop = virtualizer.scrollOffset ?? 0;
    const shown = virtualizer.getVirtualItemForOffset(offsetTop + 1);
    let from = turning.current ?? shown?.index ?? 0;
    // Back from partway down a page goes to its top first, as turning back to it would.
    if (turning.current === null && offset < 0 && shown && shown.start < offsetTop - 1) {
      from += 1;
    }
    const next = Math.max(0, Math.min(entries.length - 1, from + offset));
    turning.current = next;
    virtualizer.scrollToIndex(next, {
      align: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }
  const { slideshow, setSlideshow } = useViewParams();
  const playing = slideshow && entries.length > 1;
  // A slideshow turns a page at a time, stopping at the last.
  useSlideshowTimer(playing, entries[page], () => {
    if (page < entries.length - 1) {
      turn(1);
    } else {
      setSlideshow(false);
    }
  });
  const { fullScreen, ref: fullScreenRef, toggle: toggleFullScreen } = useFullScreen();
  // In full screen, the controls and the pointer hide while the pointer rests.
  const idleRef = useIdlePointer(fullScreen);
  // The keys scroll what has focus, so the pages take it, from a control or elsewhere.
  function fullScreenPages() {
    scroller.current?.focus({ preventScroll: true });
    toggleFullScreen();
  }
  const commands = useCommands(
    {
      contextMenu() {
        const entry = entries[page];
        if (entry) {
          showEntryMenuBelow(entry, () =>
            scroller.current?.querySelector(`[data-index="${page}"] img`)
          );
        }
      },
      fullScreen: fullScreenPages,
      next: () => turn(1),
      previous: () => turn(-1),
      rename() {
        const entry = entries[page];
        if (entry) {
          rename(entry);
        }
      },
      slideshow: () => setSlideshow(!slideshow)
    },
    { fallback: true }
  );
  const ref = useMemo(
    () => mergeRefs(fullScreenRef, idleRef, commands),
    [fullScreenRef, idleRef, commands]
  );
  // While focus is inside, turning pages is announced, since nothing focused moves to say so.
  const [focused, setFocused] = useState(false);
  return (
    // Hears when focus comes and goes inside, to announce turning pages only then.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={ref}
      aria-label="Reader"
      className="group fullscreen:bg-black relative flex min-h-0 flex-1 flex-col data-idle:cursor-none data-idle:**:cursor-none"
      data-keys="viewerFocus"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      {/* Focusable so it scrolls with the keys; double-clicking goes full screen, as the
          viewer does. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <section
        ref={attach}
        className="relative min-h-0 flex-1 scrollbar-gutter-stable overflow-auto focus-visible:outline-none"
        aria-label="Pages"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onDoubleClick={fullScreenPages}
      >
        <ViewerAnnouncement
          focused={focused}
          playing={playing}
          entry={entries[page] ?? null}
          index={page}
          count={entries.length}
        />
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            return (
              entry && (
                // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                  onContextMenu={(event) => showEntryMenu(event, entry)}
                >
                  <div className="mx-auto" style={{ maxWidth: width }}>
                    <Page entry={entry} />
                  </div>
                </div>
              )
            );
          })}
        </div>
      </section>
      <FloatingControls position="top">
        <ViewerToolbar
          item="page"
          index={page}
          count={entries.length}
          fullScreen={fullScreen}
          onFullScreen={fullScreenPages}
        />
      </FloatingControls>
    </section>
  );
}

/**
 * A folder's photos, not its videos or what is in its folders, one below the other to read
 * through as a comic or a scanned book, with no selection: the status bar names the page at
 * the top.
 */
export function ReaderView({ data }: { data: GalleryData }) {
  const scan = useScan(data);
  const { entries } = useArrangedEntries(scan, 'reader');
  const [width] = usePageWidth();
  const [page, setPage] = useState(0);
  return (
    <GalleryFrame
      data={data}
      mode="reader"
      scan={scan}
      count={entries.length}
      selected={entries[page] ?? null}
      media={entries}
    >
      {entries.length > 0 ? (
        <Pages entries={entries} width={width} onPage={setPage} />
      ) : (
        <EmptyCollection loading={scan.loading} />
      )}
    </GalleryFrame>
  );
}
