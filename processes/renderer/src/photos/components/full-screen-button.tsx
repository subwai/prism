import { useShortcut } from '#photos/shortcuts';
import { IconButton } from '@app/design-system';
import { Expand, Shrink } from 'lucide-react';

export function FullScreenButton({
  fullScreen,
  onToggle
}: {
  fullScreen: boolean;
  onToggle: () => void;
}) {
  const shortcut = useShortcut();
  return (
    <IconButton
      label={fullScreen ? 'Exit full screen' : 'Full screen'}
      shortcut={shortcut('fullScreen')}
      onClick={onToggle}
    >
      {fullScreen ? <Shrink size={14} /> : <Expand size={14} />}
    </IconButton>
  );
}
