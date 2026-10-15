import { resourceURL } from '#photos/data/urls';
import type { clientLoader } from '#routes/resources+/directory';
import type { PhotoEntry } from '@app/shared';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';

export interface FolderChildren {
  id: string;
  folders: PhotoEntry[];
  error: string | null;
}

export function LoadFolderChildren({
  id,
  onLoad
}: {
  id: string;
  onLoad: (value: FolderChildren) => void;
}) {
  const fetcher = useFetcher<typeof clientLoader>();
  const { reset } = fetcher;
  useEffect(() => () => reset(), [reset]);
  useEffect(() => {
    if (!fetcher.data && fetcher.state === 'idle') {
      fetcher.load(resourceURL('directory', { id }));
    }
  }, [fetcher, id]);
  useEffect(() => {
    if (fetcher.data) {
      const { folders, id: directoryId, state } = fetcher.data;
      onLoad({ error: state.error, folders, id: directoryId });
    }
  }, [fetcher.data, onLoad]);
  return null;
}
