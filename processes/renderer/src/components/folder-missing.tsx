import { Button, EmptyState, TitleBar } from '@prism/design-system';
import { FolderOpen, FolderX } from 'lucide-react';
import { useFetcher, useLocation, useSubmit } from 'react-router';

/**
 * In place of the library once its folder is gone, moved, renamed or deleted: until it is back,
 * which the watcher sees by itself, or another folder opens.
 */
export function FolderMissing({ name }: { name: string }) {
  const open = useFetcher({ key: 'open-library' });
  const submit = useSubmit();
  const location = useLocation();
  const opening = open.state !== 'idle';
  return (
    <main className="bg-window relative flex flex-1 flex-col">
      <TitleBar />
      <EmptyState
        icon={<FolderX size={30} strokeWidth={1} />}
        title="This folder no longer exists"
        description={`“${name}” was moved, renamed or deleted. Put it back, or choose another folder.`}
        action={
          <>
            <Button
              onClick={() =>
                submit(
                  { intent: 'refresh', returnTo: location.pathname + location.search },
                  { action: '/library', method: 'post', replace: true },
                )
              }
            >
              Try again
            </Button>
            <open.Form method="post" action="/library">
              <Button type="submit" variant="primary" disabled={opening}>
                <FolderOpen />
                {opening ? 'Opening…' : 'Choose a folder'}
              </Button>
            </open.Form>
          </>
        }
      />
    </main>
  );
}
