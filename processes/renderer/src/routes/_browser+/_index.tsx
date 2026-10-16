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
    <div className="relative flex flex-1 flex-col items-center justify-center bg-window p-8">
      <TitleBar>
        <span className="flex items-center gap-1.5 text-headline font-semibold text-label-secondary">
          <span className="font-normal text-accent">◈</span> prism
        </span>
      </TitleBar>
      <div className="mb-8 flex size-22.5 -rotate-5 items-center justify-center rounded-icon border border-separator bg-fill text-accent shadow-icon">
        <ImageIcon size={42} strokeWidth={1} />
      </div>
      <span className="text-micro tracking-eyebrow text-label-tertiary">
        YOUR PHOTOS, WHERE THEY ARE
      </span>
      <h1 className="mt-4 mb-2.5 text-display font-medium">A fresh perspective.</h1>
      <p className="mb-7 text-center leading-[1.9] text-label-secondary">
        Open a folder and make yourself at home.
        <br />
        Your collection stays right where you left it.
      </p>
      <open.Form method="post" action="/library">
        <Button type="submit" variant="primary" disabled={opening}>
          <FolderOpen size={16} />
          {opening ? 'Opening…' : 'Choose a folder'}
        </Button>
      </open.Form>
      <span className="mt-4 text-caption text-label-tertiary">
        No imports. No library to maintain.
      </span>
    </div>
  );
}
