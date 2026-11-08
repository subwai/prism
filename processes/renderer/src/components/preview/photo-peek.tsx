import { ImageViewer } from '#components/viewer/image-viewer';
import { describeExif, formatSize } from '#data/entries';
import type { GalleryView } from '#data/gallery-view';
import { type Browsing, useBrowsing, useViewEntry } from '#hooks/use-gallery-view';
import { useCommands } from '#keyboard/commands';
import { useShortcut } from '#keyboard/shortcuts';
import { PreviewSheet } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { use } from 'react';

/** A photo in a preview sheet, browsable with the arrow keys; the key that opened it closes it. */
export function PhotoPeek({
  browsing,
  selected,
  coverOf,
  onClose,
}: {
  /** Where `selected` is among what it browses; see `ImageViewer`. */
  browsing: Browsing;
  selected: PhotoEntry;
  /** The name of the folder this is shown as the cover of, if it is one. */
  coverOf?: string;
  onClose: () => void;
}) {
  const shortcut = useShortcut();
  // Shift-Space plays a video cover rather than closing it, as the keymap gives it to playback.
  const commands = useCommands(
    coverOf === undefined ? { preview: onClose } : { preview: onClose, previewCover: onClose },
  );
  const size = selected.metadata ? ` · ${formatSize(selected.metadata.size)}` : '';
  // Known once the worker has read the photo's EXIF details, which it does for every photo.
  const taken = [selected.exif && describeExif(selected.exif), selected.exif?.tags?.join(', ')]
    .filter(Boolean)
    .join(' · ');
  const kind = selected.kind === 'video' ? 'Video' : 'Photo';
  return (
    <PreviewSheet
      ref={commands}
      title={selected.name}
      caption={`${coverOf === undefined ? `${kind} preview` : `Cover of ${coverOf}`}${size}${taken ? ` · ${taken}` : ''}`}
      size="large"
      onClose={onClose}
      closeShortcut={shortcut('preview')}
    >
      <ImageViewer browsing={browsing} selected={selected} autoFocus autoHide />
    </PreviewSheet>
  );
}

/** A photo or video, browsable among the view's others. */
export function MediaPeek({
  media,
  entryId,
  onSelect,
  onClose,
}: {
  media: Promise<GalleryView>;
  entryId: string;
  onSelect: (entry: PhotoEntry) => void;
  onClose: () => void;
}) {
  const view = use(media);
  const { entry } = useViewEntry(view, entryId);
  const browsing = useBrowsing(view, entry ?? null, onSelect);
  return entry ? <PhotoPeek browsing={browsing} selected={entry} onClose={onClose} /> : null;
}
