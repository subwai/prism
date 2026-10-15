import { resourceURL } from '#photos/data/urls';
import { useVisible } from '#photos/hooks/use-visible';
import type { clientLoader as summaryLoader } from '#routes/resources+/summary';
import type { clientLoader as thumbnailLoader } from '#routes/resources+/thumbnail';
import type { PhotoEntry } from '@app/shared';
import { Folder, Image as ImageIcon, ImageOff } from 'lucide-react';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';

function ThumbnailImage({ id, folder = false }: { id?: string; folder?: boolean }) {
  const thumbnail = useFetcher<typeof thumbnailLoader>();
  const { reset } = thumbnail;
  useEffect(() => () => reset(), [reset]);
  useEffect(() => {
    if (id && thumbnail.state === 'idle' && thumbnail.data?.id !== id) {
      thumbnail.load(resourceURL('thumbnail', { id }));
    }
  }, [id, thumbnail]);
  const result = thumbnail.data?.result;
  if (result?.status === 'ready') {
    return <img src={result.url} alt="" draggable={false} />;
  }
  if (folder) {
    return <Folder size={34} strokeWidth={1.25} />;
  }
  const Icon = result ? ImageOff : ImageIcon;
  return <Icon size={24} strokeWidth={1.25} />;
}

function FolderCover({ entry, summaryKey }: { entry: PhotoEntry; summaryKey?: string }) {
  const summary = useFetcher<typeof summaryLoader>({ key: summaryKey });
  const { reset } = summary;
  useEffect(() => () => reset(), [reset]);
  useEffect(() => {
    if (summary.state === 'idle' && summary.data?.id !== entry.id) {
      summary.load(resourceURL('summary', { id: entry.id }));
    }
  }, [entry.id, summary]);
  const inspected = summary.data?.summary;
  return (
    <>
      <ThumbnailImage key={inspected?.cover?.id} id={inspected?.cover?.id} folder />
      <span className="folder-badge">
        <Folder size={12} />
        {inspected && !inspected.hasEntries ? 'Empty' : 'Folder'}
      </span>
    </>
  );
}

export function Thumbnail({ entry, summaryKey }: { entry: PhotoEntry; summaryKey?: string }) {
  const { ref, visible } = useVisible();
  const folder = entry.kind === 'directory';
  return (
    <div ref={ref} className={`thumbnail ${folder ? 'folder-thumbnail' : ''}`}>
      {visible &&
        (folder ? (
          <FolderCover key={entry.id} entry={entry} summaryKey={summaryKey} />
        ) : (
          <ThumbnailImage key={entry.id} id={entry.id} />
        ))}
    </div>
  );
}
