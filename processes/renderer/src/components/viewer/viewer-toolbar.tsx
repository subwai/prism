import { FullScreenButton } from '#components/viewer/full-screen-button';
import { useViewerPreferences } from '#data/viewer-preferences';
import { useViewParams } from '#hooks/use-view-params';
import { runCommand } from '#keyboard/commands';
import { useShortcut } from '#keyboard/shortcuts';
import { FloatingToolbar, FloatingToolbarDivider, IconButton } from '@prism/design-system';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play } from 'lucide-react';

/**
 * Browsing, the slideshow, zoom and full screen, whose buttons run the commands their keys do,
 * for the viewer's photos or the reader's pages.
 */
export function ViewerToolbar({
  item = 'photo',
  index,
  count,
  actualSize,
  fullScreen,
  onFullScreen
}: {
  /** What the controls browse, as their labels name it. */
  item?: 'photo' | 'page';
  index: number;
  count: number;
  /**
   * Whether what is shown has an actual size to switch to, as a photo has and a video has not;
   * without it, there is no zoom button.
   */
  actualSize?: 'available' | 'unavailable';
  fullScreen: boolean;
  onFullScreen: () => void;
}) {
  const shortcut = useShortcut();
  const { slideshow } = useViewParams();
  const { fit } = useViewerPreferences();
  return (
    <FloatingToolbar label={item === 'page' ? 'Page controls' : 'Photo controls'}>
      <IconButton
        label={`Previous ${item}`}
        shortcut={shortcut('previous')}
        disabled={index <= 0}
        onClick={() => runCommand('previous')}
      >
        <ChevronLeft />
      </IconButton>
      <IconButton
        label={slideshow ? 'Pause slideshow' : 'Start slideshow'}
        shortcut={shortcut('slideshow')}
        disabled={count < 2}
        onClick={() => runCommand('slideshow')}
      >
        {slideshow ? <Pause /> : <Play />}
      </IconButton>
      <IconButton
        label={`Next ${item}`}
        shortcut={shortcut('next')}
        disabled={index === -1 || index >= count - 1}
        onClick={() => runCommand('next')}
      >
        <ChevronRight />
      </IconButton>
      <FloatingToolbarDivider />
      <span className="min-w-14 text-center tabular-nums">
        {index === -1 ? '–' : `${index + 1} / ${count.toLocaleString()}`}
      </span>
      <FloatingToolbarDivider />
      {actualSize && (
        <IconButton
          label={fit ? 'View at actual size' : 'Fit to window'}
          shortcut={shortcut('actualSize')}
          disabled={actualSize === 'unavailable'}
          onClick={() => runCommand('actualSize')}
        >
          {fit ? <Maximize2 /> : <Minimize2 />}
        </IconButton>
      )}
      <FullScreenButton fullScreen={fullScreen} onToggle={onFullScreen} />
    </FloatingToolbar>
  );
}
