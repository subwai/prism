import { Plus } from 'lucide-react';
import { useEffect } from 'react';
import { Outlet, useFetcher } from 'react-router';

export default function PhotoBrowser() {
  const open = useFetcher<{ error?: string }>({ key: 'open-library' });
  const opening = open.state !== 'idle';
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() === 'o' && !opening) {
        event.preventDefault();
        open.submit({ intent: 'open' }, { action: '/library', method: 'post' });
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search current view"]')?.focus();
      }
    }
    globalThis.addEventListener('keydown', shortcut);
    return () => globalThis.removeEventListener('keydown', shortcut);
  }, [open, opening]);
  return (
    <main className="photo-app">
      <div className="app-heading">
        <span className="brand">
          <span className="brand-mark">◈</span> prism
        </span>
        <span className="app-subtitle">A little closer to your photos.</span>
        <open.Form method="post" action="/library" className="open-folder-form">
          <button type="submit" className="text-button open-folder" disabled={opening}>
            <Plus size={14} />
            {opening ? 'Opening…' : 'Open folder'}
            <kbd>⌘O</kbd>
          </button>
        </open.Form>
      </div>
      {open.data?.error && (
        <div className="error-banner" role="alert">
          {open.data.error}
        </div>
      )}
      <Outlet />
    </main>
  );
}
