import { useShortcutLabel } from '#photos/shortcuts';
import { IconButton } from '@app/design-system';
import { Expand, Shrink } from 'lucide-react';

export function FullScreenButton({
  fullScreen,
  onToggle
}: {
  fullScreen: boolean;
  onToggle: () => void;
}) {
  const label = useShortcutLabel();
  return (
    <IconButton
      label={fullScreen ? 'Exit full screen' : 'Full screen'}
      shortcut={label('fullScreen')}
      onClick={onToggle}
    >
      {fullScreen ? <Shrink size={14} /> : <Expand size={14} />}
    </IconButton>
  );
}
