import { useGlobalCommands } from '#keyboard/commands';
import { useKeymap } from '#keyboard/shortcuts';
import { Button, Toast, Window } from '@prism/design-system';
import { Outlet, useFetcher } from 'react-router';

export default function PhotoBrowser() {
  const open = useFetcher<{ error?: string }>({ key: 'open-library' });
  const { keymap, fileError } = useKeymap();
  const keyProblem = fileError ?? keymap.errors[0];
  useGlobalCommands({
    find() {
      document.querySelector<HTMLInputElement>('[aria-label="Search current view"]')?.focus();
    },
    openFolder() {
      if (open.state === 'idle') {
        open.submit({ intent: 'open' }, { action: '/library', method: 'post' });
      }
    },
  });
  return (
    <Window>
      <Outlet />
      {open.data?.error && <Toast>{open.data.error}</Toast>}
      {keyProblem && (
        <Toast>
          <span className="flex items-center gap-3">
            keybindings.json: {keyProblem}
            {keymap.errors.length > 1 && ` (and ${keymap.errors.length - 1} more)`}
            <Button onClick={() => globalThis.app.keybindings.open()}>Edit</Button>
          </span>
        </Toast>
      )}
    </Window>
  );
}
