import { useGlobalCommands } from '#keyboard/commands';
import { useKeymap } from '#keyboard/shortcuts';
import { putOffUpdate, useUpdateNotice, useUpdateReady } from '#update-notice';
import { Button, Toast, Window } from '@prism/design-system';
import { Outlet, useFetcher } from 'react-router';

export default function PhotoBrowser() {
  const open = useFetcher<{ error?: string }>({ key: 'open-library' });
  const { keymap, fileError } = useKeymap();
  const keyProblem = fileError ?? keymap.errors[0];
  const updateNotice = useUpdateNotice();
  const updateReady = useUpdateReady();
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
      {updateNotice ? (
        <Toast tone={updateNotice.warning ? 'warning' : 'info'}>{updateNotice.message}</Toast>
      ) : (
        updateReady && (
          // Stays until the user restarts or puts it off, so the notice of a check takes its
          // place for a moment rather than covering it.
          <Toast tone="info">
            <span className="flex items-center gap-3">
              <span>An update is ready.</span>
              <Button onClick={putOffUpdate}>Later</Button>
              <Button onClick={() => globalThis.app.updates.install()}>Restart</Button>
            </span>
          </Toast>
        )
      )}
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
