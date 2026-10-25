import { ImageViewer, type ViewerState } from '#photos/components/image-viewer';
import { formatSize } from '#photos/data/entries';
import { useShortcut } from '#photos/shortcuts';
import { PreviewSheet } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';

/** A photo in a preview sheet, browsable with the arrow keys. */
export function PhotoPeek({
  entries,
  selected,
  onSelect,
  onClose,
  viewer
}: {
  entries: PhotoEntry[];
  selected: PhotoEntry;
  onSelect: (entry: PhotoEntry) => void;
  onClose: () => void;
  viewer: ViewerState;
}) {
  const shortcut = useShortcut();
  const size = selected.metadata ? ` · ${formatSize(selected.metadata.size)}` : '';
  return (
    <PreviewSheet
      title={selected.name}
      caption={`${selected.kind === 'video' ? 'Video' : 'Photo'} preview${size}`}
      size="large"
      onClose={onClose}
      closeShortcut={shortcut('preview')}
    >
      <ImageViewer
        entries={entries}
        selected={selected}
        onSelect={onSelect}
        viewer={viewer}
        autoFocus
      />
    </PreviewSheet>
  );
}
