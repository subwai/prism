import { Example, Section } from '#components/design-system/section';
import {
  Breadcrumbs,
  Button,
  IconButton,
  SearchField,
  SegmentedControl,
  Select,
  Slider,
  TextField,
  Toolbar,
  ToolbarGroup,
} from '@prism/design-system';
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  GalleryHorizontalEnd,
  Grid2X2,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react';
import { useState } from 'react';

const SHORTCUT = { keys: 'Meta+F', label: '⌘F' };

export function Buttons() {
  return (
    <Section title="Buttons">
      <div className="flex flex-wrap items-end gap-6">
        <Example label="primary">
          <Button variant="primary">
            <FolderOpen />
            Choose a folder
          </Button>
        </Example>
        <Example label="primary, disabled">
          <Button variant="primary" disabled>
            Rename
          </Button>
        </Example>
        <Example label="plain">
          <Button>Cancel</Button>
        </Example>
        <Example label="plain, disabled">
          <Button disabled>Cancel</Button>
        </Example>
        <Example label="icon">
          <IconButton label="Refresh folder" shortcut={{ keys: 'Meta+R', label: '⌘R' }}>
            <RefreshCw />
          </IconButton>
        </Example>
        <Example label="icon, pressed">
          <IconButton label="Mute" pressed>
            <Volume2 />
          </IconButton>
        </Example>
        <Example label="icon, disabled">
          <IconButton label="Go back" disabled>
            <ArrowLeft />
          </IconButton>
        </Example>
      </div>
    </Section>
  );
}

export function Fields() {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'grid' | 'filmstrip'>('grid');
  const [sort, setSort] = useState('name');
  const [size, setSize] = useState(160);
  return (
    <Section title="Fields">
      <div className="grid grid-cols-3 items-start gap-6">
        <Example label="search">
          <SearchField
            label="Search"
            placeholder="Search"
            shortcut={SHORTCUT}
            value={search}
            onChange={setSearch}
          />
        </Example>
        <Example label="search, filled">
          <SearchField
            label="Search, filled"
            placeholder="Search"
            value="landscape"
            onChange={() => null}
          />
        </Example>
        <Example label="segmented">
          <SegmentedControl
            label="Gallery view"
            value={mode}
            onChange={setMode}
            segments={[
              { icon: <Grid2X2 />, label: 'Grid view', value: 'grid' },
              { icon: <GalleryHorizontalEnd />, label: 'Filmstrip view', value: 'filmstrip' },
            ]}
          />
        </Example>
        <Example label="text">
          <TextField label="Name" defaultValue="landscape.jpg" />
        </Example>
        <Example label="text, with an error">
          <TextField
            label="Name, with an error"
            defaultValue="portrait.jpg"
            error="An item named “portrait.jpg” already exists."
          />
        </Example>
        <Example label="select and slider">
          <div className="flex items-center gap-4">
            <Select
              label="Sort by"
              value={sort}
              onChange={setSort}
              options={[
                { label: 'Name', value: 'name' },
                { label: 'Modified', value: 'modified' },
              ]}
            />
            <Slider
              label="Thumbnail size"
              icon={<SlidersHorizontal size={13} />}
              min={110}
              max={240}
              step={10}
              value={size}
              onChange={setSize}
            />
          </div>
        </Example>
      </div>
    </Section>
  );
}

/** The toolbar at two widths, as a sidebar beside it would leave it. */
export function Toolbars() {
  const trail = [
    { key: 'home', label: 'Pictures' },
    { key: 'trips', label: 'Trips' },
    { key: 'iceland', label: 'Iceland 2024' },
  ];
  return (
    <Section title="Toolbar">
      {['w-130', 'w-200'].map((width) => (
        <div key={width} className={`${width} rounded-card bg-content inset-ring-edge inset-ring`}>
          <Toolbar>
            <ToolbarGroup>
              <IconButton label="Go back">
                <ArrowLeft />
              </IconButton>
              <IconButton label="Go forward" disabled>
                <ArrowRight />
              </IconButton>
            </ToolbarGroup>
            <Breadcrumbs label="Folder path" items={trail} onSelect={() => null} />
            <Select
              label="Sort by"
              showLabel
              value="name"
              onChange={() => null}
              options={[{ label: 'Name', value: 'name' }]}
            />
            <div className="w-36 shrink-0 @3xl:w-52">
              <SearchField label="Search" placeholder="Search" value="" onChange={() => null} />
            </div>
          </Toolbar>
        </div>
      ))}
    </Section>
  );
}
