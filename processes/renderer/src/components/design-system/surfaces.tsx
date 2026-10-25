import { Section } from '#components/design-system/section';
import {
  Badge,
  Banner,
  Button,
  Dialog,
  DialogFooter,
  DialogTitle,
  EmptyState,
  FloatingControls,
  FloatingToolbar,
  FloatingToolbarDivider,
  IconButton,
  Kbd,
  LoadingState,
  MediaCaption,
  PreviewSheet,
  ShimmerText,
  Sidebar,
  SidebarFooter,
  SidebarHeading,
  SidebarRow,
  Spinner,
  StatusIndicator,
  TextField,
  Toast
} from '@prism/design-system';
import { ChevronLeft, ChevronRight, Folder, ImageOff, Play, Video } from 'lucide-react';
import { useId, useState } from 'react';

export function Lists() {
  return (
    <Section title="Sidebar">
      <div className="rounded-card inset-ring-edge flex h-72 w-fit overflow-hidden inset-ring">
        <Sidebar label="Example sidebar">
          <div className="h-3" />
          <SidebarHeading accessory={<Badge>Local</Badge>}>Folders</SidebarHeading>
          <div className="flex flex-col px-2.5">
            {['Pictures', 'Trips', 'Iceland 2024', 'Family'].map((name, index) => (
              <SidebarRow key={name} selected={index === 2} className="pl-2">
                <Folder size={14} className="text-label-tertiary mr-1.5" />
                <span className="truncate">{name}</span>
              </SidebarRow>
            ))}
          </div>
          <div className="flex-1" />
          <SidebarFooter>
            <StatusIndicator busy={false}>1,204 photos</StatusIndicator>
          </SidebarFooter>
        </Sidebar>
      </div>
    </Section>
  );
}

export function Feedback() {
  return (
    <Section title="Feedback">
      <div className="rounded-card inset-ring-edge overflow-hidden inset-ring">
        <Banner action={<Button>Try again</Button>}>Some folders could not be read.</Banner>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <StatusIndicator busy>Reading folder…</StatusIndicator>
        <StatusIndicator busy={false}>Up to date</StatusIndicator>
        <Spinner label="Loading" />
        <Badge>All photos</Badge>
        <Kbd>⇧⌘F</Kbd>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-card bg-fill flex h-40">
          <LoadingState />
        </div>
        <div className="rounded-card bg-fill flex h-40 items-center justify-center">
          <ShimmerText>Prism</ShimmerText>
        </div>
        <div className="rounded-card bg-fill flex h-40">
          <EmptyState
            icon={<ImageOff size={30} strokeWidth={1.25} />}
            title="Unable to display this photo"
            description="The original may be missing."
          />
        </div>
      </div>
    </Section>
  );
}

export function Media() {
  return (
    <Section title="Media">
      <div className="flex gap-4">
        {[
          { caption: 'Folder', icon: <Folder /> },
          { caption: undefined, icon: <Video /> }
        ].map(({ caption, icon }, index) => (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- A fixed list.
            key={index}
            className="rounded-inner from-label-tertiary to-fill relative size-32 overflow-hidden bg-linear-to-br"
          >
            <MediaCaption icon={icon}>{caption}</MediaCaption>
          </div>
        ))}
        {/* Shown, not hovered for: these controls appear over media on hover or focus. */}
        <div className="group rounded-card bg-fill relative flex h-32 flex-1 items-center justify-center">
          <span className="text-label-tertiary text-xs">Hover to show the controls</span>
          <FloatingControls position="bottom">
            <FloatingToolbar label="Example controls">
              <IconButton label="Previous photo">
                <ChevronLeft />
              </IconButton>
              <IconButton label="Play">
                <Play />
              </IconButton>
              <IconButton label="Next photo">
                <ChevronRight />
              </IconButton>
              <FloatingToolbarDivider />
              <span className="min-w-14 text-center tabular-nums">3 / 12</span>
            </FloatingToolbar>
          </FloatingControls>
        </div>
      </div>
      {/* Pressed at the ends and in the middle, to show the ends follow the pill's shape. */}
      <FloatingToolbar label="Example toolbar" className="w-fit">
        <IconButton label="Previous" pressed>
          <ChevronLeft />
        </IconButton>
        <IconButton label="Play" pressed>
          <Play />
        </IconButton>
        <FloatingToolbarDivider />
        <span className="min-w-14 text-center tabular-nums">3 / 12</span>
        <FloatingToolbarDivider />
        <IconButton label="Next" pressed>
          <ChevronRight />
        </IconButton>
      </FloatingToolbar>
    </Section>
  );
}

export function Overlays() {
  const [open, setOpen] = useState<'dialog' | 'sheet' | 'toast' | null>(null);
  const titleId = useId();
  return (
    <Section title="Overlays">
      <div className="flex gap-3">
        <Button onClick={() => setOpen('dialog')}>Open dialog</Button>
        <Button onClick={() => setOpen('sheet')}>Open preview sheet</Button>
        <Button onClick={() => setOpen(open === 'toast' ? null : 'toast')}>Toggle toast</Button>
      </div>
      {open === 'dialog' && (
        <Dialog labelledBy={titleId} size="small" onClose={() => setOpen(null)}>
          <DialogTitle id={titleId}>Rename “landscape.jpg”</DialogTitle>
          <TextField label="Name" defaultValue="landscape.jpg" autoFocus />
          <DialogFooter>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(null)}>
              Rename
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {open === 'sheet' && (
        <PreviewSheet
          title="Iceland 2024"
          caption="Folder"
          size="medium"
          onClose={() => setOpen(null)}
        >
          <EmptyState description="No photos or folders here" />
        </PreviewSheet>
      )}
      {open === 'toast' && <Toast>The folder could not be watched for changes.</Toast>}
    </Section>
  );
}
