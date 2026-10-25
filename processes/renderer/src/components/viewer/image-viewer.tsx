import { useEntryMenu, useEntryMenuBelow, useRenameEntry } from '#components/entry-menu';
import { Original } from '#components/viewer/original';
import { useFullScreen } from '#components/viewer/use-full-screen';
import { useIdlePointer } from '#components/viewer/use-idle-pointer';
import { useSlideshowTimer } from '#components/viewer/use-slideshow-timer';
import { ViewerAnnouncement } from '#components/viewer/viewer-announcement';
import { ViewerToolbar } from '#components/viewer/viewer-toolbar';
import { useViewParams } from '#hooks/use-view-params';
import { useCommands } from '#keyboard/commands';
import { cn, EmptyState, FloatingControls, mergeRefs } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useDeferredValue, useMemo, useRef, useState } from 'react';

/**
 * Shows the selected photo or video among `entries`, and browses them. The photo and video
 * handle their own zoom and playback; this handles moving between them, the slideshow's
 * timing and full screen. While something covers it, it is not `active`: it leaves the keys
 * to what covers it, and its video pauses.
 */
export function ImageViewer({
  entries,
  selected,
  onSelect,
  autoFocus = false,
  active = true
}: {
  entries: PhotoEntry[];
  selected: PhotoEntry | null;
  onSelect: (entry: PhotoEntry) => void;
  /** Takes focus when its dialog opens, so its keys work without clicking the photo first. */
  autoFocus?: boolean;
  active?: boolean;
}) {
  const showEntryMenu = useEntryMenu();
  const showEntryMenuBelow = useEntryMenuBelow();
  const rename = useRenameEntry();
  const { slideshow } = useViewParams();
  // While focus is inside, browsing is announced, since nothing focused moves to say so.
  const [focused, setFocused] = useState(false);
  const index = entries.findIndex((entry) => entry.id === selected?.id);
  // The selection moves at once; the viewer follows when it can, however fast the arrow keys
  // repeat.
  const shown = useDeferredValue(selected);
  // The last one shown in full. It stays on screen, hiding the next, until that one has
  // decoded or has a frame of video to show, rather than a placeholder or a poster: a poster
  // can take a frame to paint, and Chromium draws it darker than the video itself.
  const [settled, setSettled] = useState<PhotoEntry | null>(null);
  const leaving = settled && shown && settled.id !== shown.id ? settled : null;
  const section = useRef<HTMLElement>(null);
  const { fullScreen, ref: fullScreenRef, toggle: toggleFullScreen } = useFullScreen();
  // In full screen, the controls and the pointer hide while the pointer rests.
  const idleRef = useIdlePointer(fullScreen);
  function move(offset: number) {
    const next = entries[index + offset];
    if (next) {
      onSelect(next);
    }
  }
  function advance() {
    const next = entries[(index + 1) % entries.length];
    if (next) {
      onSelect(next);
    }
  }
  // A slideshow shows each photo for a while, and each video until it ends.
  const playing = active && slideshow && entries.length > 1;
  useSlideshowTimer(playing, selected, advance);
  const commands = useCommands(
    {
      // Opens the menu for what is shown, below it.
      contextMenu: () =>
        shown && showEntryMenuBelow(shown, () => section.current?.querySelector('img, video')),
      fullScreen: toggleFullScreen,
      next: () => move(1),
      previous: () => move(-1),
      rename: () => selected && rename(selected)
    },
    { fallback: true }
  );
  const ref = useMemo(
    () => mergeRefs(section, fullScreenRef, idleRef, commands),
    [fullScreenRef, idleRef, commands]
  );

  return (
    // Focusable so the keymap's viewer keys, such as Left and Right, work once it has focus.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={ref}
      className="group fullscreen:bg-black relative flex min-h-0 flex-1 flex-col focus-visible:outline-none data-idle:cursor-none data-idle:**:cursor-none"
      aria-label="Image preview"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-autofocus={autoFocus || undefined}
      data-keys="viewerFocus"
      data-layer-keys="viewerShown"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <ViewerAnnouncement
        focused={focused}
        playing={slideshow}
        entry={selected}
        index={index}
        count={entries.length}
      />
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="relative min-h-0 flex-1"
        onContextMenu={(event) => shown && showEntryMenu(event, shown)}
      >
        {shown ? (
          [leaving, shown].map(
            (entry) =>
              entry && (
                <div
                  key={entry.id}
                  className={cn('contents', leaving && entry !== leaving && 'invisible')}
                  inert={entry === leaving}
                >
                  <Original
                    entry={entry}
                    active={active && entry !== leaving}
                    onFinished={playing && entry !== leaving ? advance : undefined}
                    onShown={entry === leaving ? undefined : () => setSettled(entry)}
                  />
                </div>
              )
          )
        ) : (
          <EmptyState className="absolute inset-0" description="Your photos will appear here" />
        )}
      </div>
      {/* Controls stay out of the way until the pointer or focus is over the photo, and in full
          screen while the pointer rests. Browsing sits at the top, leaving the bottom to a
          video's own controls. */}
      <FloatingControls position="top">
        <ViewerToolbar
          index={index}
          count={entries.length}
          actualSize={shown?.kind === 'video' ? 'unavailable' : 'available'}
          fullScreen={fullScreen}
          onFullScreen={toggleFullScreen}
        />
      </FloatingControls>
    </section>
  );
}
