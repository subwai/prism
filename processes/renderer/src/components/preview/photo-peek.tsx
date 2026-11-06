import { ImageViewer } from '#components/viewer/image-viewer';
import { formatSize } from '#data/entries';
import { useCommands } from '#keyboard/commands';
import { useShortcut } from '#keyboard/shortcuts';
import { PreviewSheet } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';

/** A photo in a preview sheet, browsable with the arrow keys; the key that opened it closes it. */
export function PhotoPeek({
  entries,
  selected,
  coverOf,
  onSelect,
  onClose,
}: {
  entries: PhotoEntry[];
  selected: PhotoEntry;
  /** The name of the folder this is shown as the cover of, if it is one. */
  coverOf?: string;
  /** Left out where there is nothing to browse to, as with a folder's cover on its own. */
  onSelect?: (entry: PhotoEntry) => void;
  onClose: () => void;
}) {
  const shortcut = useShortcut();
  // Shift-Space plays a video cover rather than closing it, as the keymap gives it to playback.
  const commands = useCommands(
    coverOf === undefined ? { preview: onClose } : { preview: onClose, previewCover: onClose },
  );
  const size = selected.metadata ? ` · ${formatSize(selected.metadata.size)}` : '';
  const kind = selected.kind === 'video' ? 'Video' : 'Photo';
  return (
    <PreviewSheet
      ref={commands}
      title={selected.name}
      caption={`${coverOf === undefined ? `${kind} preview` : `Cover of ${coverOf}`}${size}`}
      size="large"
      onClose={onClose}
      closeShortcut={shortcut('preview')}
    >
      <ImageViewer entries={entries} selected={selected} onSelect={onSelect} autoFocus />
    </PreviewSheet>
  );
}
