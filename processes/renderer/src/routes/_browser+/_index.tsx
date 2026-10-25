import { restoreLibrary } from '#photos/data/session';
import { Button, TitleBar } from '@app/design-system';
import { FolderOpen, Image as ImageIcon } from 'lucide-react';
import { replace, useFetcher } from 'react-router';

export async function clientLoader() {
  // Replaced, not pushed: going back must not return here and bounce forward again.
  if (await restoreLibrary()) {
    throw replace('/library/grid');
  }
  return null;
}

export default function Welcome() {
  const open = useFetcher({ key: 'open-library' });
  const opening = open.state !== 'idle';
  return (
    <main className="bg-window relative flex flex-1 flex-col items-center justify-center p-8">
      <TitleBar>
        <span className="text-md text-label-secondary flex items-center gap-1.5 font-semibold">
          <span className="text-accent font-normal">◈</span> prism
        </span>
      </TitleBar>
      <div className="rounded-icon border-separator bg-fill text-accent shadow-icon mb-8 flex size-22.5 -rotate-5 items-center justify-center border">
        <ImageIcon size={42} strokeWidth={1} />
      </div>
      <span className="eyebrow">Your photos, where they are</span>
      <h1 className="mt-4 mb-2.5 text-3xl font-medium">A fresh perspective.</h1>
      <p className="text-label-secondary mb-7 text-center leading-loose">
        Open a folder and make yourself at home.
        <br />
        Your collection stays right where you left it.
      </p>
      <open.Form method="post" action="/library">
        <Button type="submit" variant="primary" disabled={opening}>
          <FolderOpen />
          {opening ? 'Opening…' : 'Choose a folder'}
        </Button>
      </open.Form>
      <span className="text-label-tertiary mt-4 text-xs">No imports. No library to maintain.</span>
    </main>
  );
}
