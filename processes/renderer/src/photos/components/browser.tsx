import { useCommand } from '#photos/hooks/use-command';
import { Toast, Window } from '@app/design-system';
import { Outlet, useFetcher } from 'react-router';

export default function PhotoBrowser() {
  const open = useFetcher<{ error?: string }>({ key: 'open-library' });
  useCommand('open-folder', () => {
    if (open.state === 'idle') {
      open.submit({ intent: 'open' }, { action: '/library', method: 'post' });
    }
  });
  useCommand('find', () => {
    document.querySelector<HTMLInputElement>('[aria-label="Search current view"]')?.focus();
  });
  return (
    <Window>
      <Outlet />
      {open.data?.error && <Toast>{open.data.error}</Toast>}
    </Window>
  );
}
