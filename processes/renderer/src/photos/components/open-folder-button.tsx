import { useShortcut } from '#keyboard/shortcuts';
import { IconButton } from '@prism/design-system';
import { FolderOpen } from 'lucide-react';
import { useFetcher } from 'react-router';

export function OpenFolderButton() {
  const shortcut = useShortcut();
  const open = useFetcher({ key: 'open-library' });
  return (
    <open.Form method="post" action="/library">
      <IconButton
        type="submit"
        label="Open folder"
        shortcut={shortcut('openFolder')}
        disabled={open.state !== 'idle'}
      >
        <FolderOpen />
      </IconButton>
    </open.Form>
  );
}
