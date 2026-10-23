import { useShortcutLabel } from '#photos/shortcuts';
import { IconButton } from '@app/design-system';
import { FolderOpen } from 'lucide-react';
import { useFetcher } from 'react-router';

export function OpenFolderButton() {
  const label = useShortcutLabel();
  const open = useFetcher({ key: 'open-library' });
  return (
    <open.Form method="post" action="/library">
      <IconButton
        type="submit"
        label="Open folder"
        shortcut={label('openFolder')}
        disabled={open.state !== 'idle'}
      >
        <FolderOpen size={16} />
      </IconButton>
    </open.Form>
  );
}
