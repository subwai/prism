import { useCommands } from '#keyboard/commands';
import { useShortcut } from '#keyboard/shortcuts';
import { ImageViewer } from '#photos/components/image-viewer';
import { formatSize } from '#photos/data/entries';
import { PreviewSheet } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';

/** A photo in a preview sheet, browsable with the arrow keys; the key that opened it closes it. */
export function PhotoPeek({
  entries,
  selected,
  onSelect,
  onClose
}: {
  entries: PhotoEntry[];
  selected: PhotoEntry;
  onSelect: (entry: PhotoEntry) => void;
  onClose: () => void;
}) {
  const shortcut = useShortcut();
  const commands = useCommands({ preview: onClose });
  const size = selected.metadata ? ` · ${formatSize(selected.metadata.size)}` : '';
  return (
    <PreviewSheet
      ref={commands}
      title={selected.name}
      caption={`${selected.kind === 'video' ? 'Video' : 'Photo'} preview${size}`}
      size="large"
      onClose={onClose}
      closeShortcut={shortcut('preview')}
    >
      <ImageViewer entries={entries} selected={selected} onSelect={onSelect} autoFocus />
    </PreviewSheet>
  );
}
