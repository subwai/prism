import { SidebarFooter, Slider } from '@prism/design-system';
import { FolderOpen, SlidersHorizontal } from 'lucide-react';

/** Folder covers grow with the footer's slider, as rows do with them, from icon size up. */
export const COVER_SIZE = { default: 32, max: 64, min: 22 };

/** Names the open library and sizes the tree's folder covers. */
export function FolderTreeFooter({
  name,
  coverSize,
  onCoverSize,
}: {
  name: string;
  coverSize: number;
  onCoverSize: (size: number) => void;
}) {
  return (
    <SidebarFooter>
      <FolderOpen size={14} className="shrink-0" />
      <span className="truncate">{name}</span>
      <span className="ml-auto shrink-0">
        <Slider
          label="Folder cover size"
          icon={<SlidersHorizontal size={13} />}
          min={COVER_SIZE.min}
          max={COVER_SIZE.max}
          step={2}
          value={coverSize}
          defaultValue={COVER_SIZE.default}
          onChange={onCoverSize}
        />
      </span>
    </SidebarFooter>
  );
}
