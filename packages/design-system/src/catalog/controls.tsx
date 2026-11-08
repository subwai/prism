import { Example, Section } from '#catalog/section';
import {
  Breadcrumbs,
  Button,
  IconButton,
  type SearchToken,
  SegmentedControl,
  Select,
  Slider,
  TextField,
  type TokenGroup,
  TokenSearchField,
  Toolbar,
  ToolbarGroup,
} from '#index';
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

const GROUPS: TokenGroup[] = [
  {
    field: 'camera',
    label: 'Camera',
    values: [
      { count: 128, value: 'X100V' },
      { count: 42, value: 'EOS R5' },
    ],
  },
  { field: 'tag', label: 'Tag', values: [{ count: 17, value: 'Beach' }] },
];

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
  const [tokens, setTokens] = useState<SearchToken[]>([]);
  const [mode, setMode] = useState<'grid' | 'filmstrip'>('grid');
  const [sort, setSort] = useState('name');
  const [size, setSize] = useState(160);
  return (
    <Section title="Fields">
      <div className="grid grid-cols-3 items-start gap-6">
        <Example label="search">
          <TokenSearchField
            label="Search"
            placeholder="Search or filter"
            shortcut={SHORTCUT}
            query={search}
            onQueryChange={setSearch}
            tokens={tokens}
            onTokensChange={setTokens}
            groups={GROUPS}
            empty="No filters match"
          />
        </Example>
        <Example label="search, filtered">
          <TokenSearchField
            label="Search, filtered"
            query="beach"
            onQueryChange={() => null}
            tokens={[{ field: 'camera', value: 'X100V' }]}
            onTokensChange={() => null}
            groups={GROUPS}
            empty="No filters match"
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
            <div className="w-48 shrink-0 @3xl:w-72">
              <TokenSearchField
                label="Search"
                placeholder="Search or filter"
                query=""
                onQueryChange={() => null}
                tokens={[]}
                onTokensChange={() => null}
                groups={GROUPS}
                empty="No filters match"
              />
            </div>
          </Toolbar>
        </div>
      ))}
    </Section>
  );
}
