import { FolderPeek } from '#components/preview/folder-peek';
import { PhotoPeek } from '#components/preview/photo-peek';
import { QueryValue } from '#components/query-value';
import { useLibrary } from '#hooks/use-library';
import { useViewParams } from '#hooks/use-view-params';
import type { PhotoEntry } from '@prism/shared';

/** A folder's cover on its own, found among the covers its tile chose it from. */
function CoverPeek({
  folderId,
  coverId,
  onClose,
}: {
  folderId: string;
  coverId: string;
  onClose: () => void;
}) {
  const library = useLibrary();
  const folder = library.trail(folderId)?.at(-1);
  return (
    <QueryValue query={library.summaryQuery(folderId)}>
      {(summary) => {
        const cover = summary?.covers.find((entry) => entry.id === coverId);
        return cover && folder ? (
          <PhotoPeek entries={[cover]} selected={cover} coverOf={folder.name} onClose={onClose} />
        ) : null;
      }}
    </QueryValue>
  );
}

/**
 * The preview the URL names, over the view: a photo or video, browsable among `media`, a
 * folder, browsable into its subfolders, or a folder's cover. An entry renamed in this window
 * is found under its new name.
 */
export function Preview({
  media,
  folderId,
  onOpenFolder,
}: {
  media: PhotoEntry[];
  /** The folder the view shows, which a folder preview never goes up to. */
  folderId: string;
  onOpenFolder: (folderId: string) => void;
}) {
  const library = useLibrary();
  const { preview, cover, showPreview, closePreview } = useViewParams();
  if (preview === null) {
    return null;
  }
  if (cover !== null) {
    return <CoverPeek folderId={cover} coverId={preview} onClose={closePreview} />;
  }
  const photo = library.locate(media, preview);
  if (photo) {
    return (
      <PhotoPeek
        entries={media}
        selected={photo}
        onSelect={(entry) => showPreview(entry.id)}
        onClose={closePreview}
      />
    );
  }
  const trail = library.trail(preview) ?? library.trail(library.follow(preview));
  const folder = trail?.at(-1);
  return trail && folder ? (
    <FolderPeek
      folder={folder}
      canGoUp={trail.at(-2)?.id !== folderId}
      onMove={showPreview}
      onOpen={onOpenFolder}
      onClose={closePreview}
    />
  ) : null;
}
