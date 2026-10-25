import { useShortcut } from '#keyboard/shortcuts';
import { IconButton } from '@prism/design-system';
import { Expand, Shrink } from 'lucide-react';

export function FullScreenButton({
  fullScreen,
  onToggle,
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
      {fullScreen ? <Shrink /> : <Expand />}
    </IconButton>
  );
}
