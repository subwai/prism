import type { FolderTrail } from '#photos/components/folder-tree';
import type { SortOrder, ViewMode } from '#photos/data/entries';
import { useShortcut } from '#photos/shortcuts';
import {
  Breadcrumbs,
  IconButton,
  SearchField,
  SegmentedControl,
  Select,
  ToolbarGroup,
  Toolbar as WindowToolbar
} from '@app/design-system';
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpAZ,
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw
} from 'lucide-react';

interface ToolbarProps {
  trail: FolderTrail;
  back: boolean;
  forward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (trail: FolderTrail) => void;
  onRefresh: () => void;
  /** Counts refreshes; each one spins the refresh icon once. */
  refreshes: number;
  search: string;
  onSearch: (value: string) => void;
  sort: SortOrder;
  onSort: (value: SortOrder) => void;
  descending: boolean;
  onDescending: () => void;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
}

export function Toolbar(props: ToolbarProps) {
  const shortcut = useShortcut();
  return (
    <WindowToolbar>
      <ToolbarGroup>
        <IconButton
          label="Go back"
          shortcut={shortcut('back')}
          disabled={!props.back}
          onClick={props.onBack}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Go forward"
          shortcut={shortcut('forward')}
          disabled={!props.forward}
          onClick={props.onForward}
        >
          <ArrowRight />
        </IconButton>
        <IconButton
          label="Go up"
          shortcut={shortcut('up')}
          disabled={props.trail.length < 2}
          onClick={() => props.onNavigate(props.trail.slice(0, -1))}
        >
          <ArrowUp />
        </IconButton>
      </ToolbarGroup>
      <Breadcrumbs
        label="Folder path"
        items={props.trail.map((folder) => ({ key: folder.id, label: folder.name }))}
        onSelect={(index) => props.onNavigate(props.trail.slice(0, index + 1))}
      />
      <ToolbarGroup>
        <Select
          label="Sort by"
          value={props.sort}
          onChange={props.onSort}
          options={[
            { label: 'Name', value: 'name' },
            { label: 'Modified', value: 'modified' },
            { label: 'Created', value: 'created' },
            { label: 'Size', value: 'size' }
          ]}
        />
        <IconButton
          label={props.descending ? 'Sort ascending' : 'Sort descending'}
          onClick={props.onDescending}
        >
          {props.descending ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </IconButton>
        <IconButton label="Refresh folder" shortcut={shortcut('refresh')} onClick={props.onRefresh}>
          {/* A new key restarts the animation for every refresh. */}
          <RefreshCw
            key={props.refreshes}

            className={props.refreshes > 0 ? 'animate-spin-once' : undefined}
          />
        </IconButton>
      </ToolbarGroup>
      <div className="w-36 shrink-0 @3xl:w-52">
        <SearchField
          label="Search current view"
          placeholder="Search"
          shortcut={shortcut('find')}
          value={props.search}
          onChange={props.onSearch}
        />
      </div>
      <SegmentedControl
        label="Gallery view"
        value={props.mode}
        onChange={props.onMode}
        segments={[
          {
            icon: <Grid2X2 />,
            label: 'Grid view',
            shortcut: shortcut('toggleView'),
            value: 'grid'
          },
          {
            icon: <GalleryHorizontalEnd />,
            label: 'Filmstrip view',
            shortcut: shortcut('toggleView'),
            title: 'Filmstrip · includes subfolders',
            value: 'filmstrip'
          }
        ]}
      />
    </WindowToolbar>
  );
}
