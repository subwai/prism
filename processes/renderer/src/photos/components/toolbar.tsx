import type { FolderTrail } from '#photos/components/folder-tree';
import type { SortOrder, ViewMode } from '#photos/data/entries';
import { sortOrder } from '#photos/data/urls';
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpAZ,
  ChevronRight,
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw,
  Search
} from 'lucide-react';

interface ToolbarProps {
  trail: FolderTrail;
  back: boolean;
  forward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (trail: FolderTrail) => void;
  onRefresh: () => void;
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
  return (
    <>
      <header className="toolbar">
        <div className="navigation-buttons">
          <button
            type="button"
            className="icon-button"
            aria-label="Go back"
            disabled={!props.back}
            onClick={props.onBack}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Go forward"
            disabled={!props.forward}
            onClick={props.onForward}
          >
            <ArrowRight size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Go up"
            disabled={props.trail.length < 2}
            onClick={() => props.onNavigate(props.trail.slice(0, -1))}
          >
            <ArrowUp size={17} />
          </button>
        </div>
        <nav className="breadcrumbs" aria-label="Folder path">
          {props.trail.map((folder, index) => (
            <span key={folder.id}>
              {index > 0 && <ChevronRight size={12} />}
              <button
                type="button"
                aria-current={index === props.trail.length - 1 ? 'location' : undefined}
                onClick={() => props.onNavigate(props.trail.slice(0, index + 1))}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh folder"
          title="Refresh (⌘R)"
          onClick={props.onRefresh}
        >
          <RefreshCw size={15} />
        </button>
        <div className="view-switch" aria-label="Gallery view">
          <button
            type="button"
            className="icon-button"
            aria-label="Grid view"
            aria-pressed={props.mode === 'grid'}
            onClick={() => props.onMode('grid')}
          >
            <Grid2X2 size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Filmstrip view"
            title="Filmstrip · includes subfolders"
            aria-pressed={props.mode === 'filmstrip'}
            onClick={() => props.onMode('filmstrip')}
          >
            <GalleryHorizontalEnd size={17} />
          </button>
        </div>
      </header>
      <div className="gallery-toolbar">
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="Search current view"
            type="search"
            placeholder="Search this view"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
          />
          <kbd>⌘F</kbd>
        </label>
        <div className="sorting">
          <label>
            <span>Sort by</span>
            <select
              aria-label="Sort by"
              value={props.sort}
              onChange={(event) =>
                props.onSort(sortOrder(new URLSearchParams({ sort: event.target.value })))
              }
            >
              <option value="name">Name</option>
              <option value="modified">Modified</option>
              <option value="created">Created</option>
              <option value="size">Size</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={props.descending ? 'Sort ascending' : 'Sort descending'}
            onClick={props.onDescending}
          >
            {props.descending ? <ArrowUpAZ size={16} /> : <ArrowDownAZ size={16} />}
          </button>
        </div>
      </div>
    </>
  );
}
