import { FolderPeek } from '#components/preview/folder-peek';
import { PhotoPeek } from '#components/preview/photo-peek';
import { useLibrary } from '#hooks/use-library';
import { useViewParams } from '#hooks/use-view-params';
import type { PhotoEntry } from '@prism/shared';

/**
 * The preview the URL names, over the view: a photo or video, browsable among `media`, or a
 * folder, browsable into its subfolders. An entry renamed in this window is found under its
 * new name.
 */
export function Preview({
  media,
  folderId,
  onOpenFolder
}: {
  media: PhotoEntry[];
  /** The folder the view shows, which a folder preview never goes up to. */
  folderId: string;
  onOpenFolder: (folderId: string) => void;
}) {
  const library = useLibrary();
  const { preview, showPreview, closePreview } = useViewParams();
  if (preview === null) {
    return null;
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
