import { formatSize } from '#data/entries';
import {
  batchContentsQuery,
  batchDateLabel,
  batchViewLabel,
  type PrismTrashActionResult,
  prismTrashQuery,
  putBackText,
} from '#data/prism-trash';
import { countsLabel } from '#data/trash';
import { useLibrary } from '#hooks/use-library';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogTitle,
  EmptyState,
  Toast,
  Toolbar,
} from '@prism/design-system';
import type { PrismTrashBatchInfo } from '@prism/shared';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useFetcher } from 'react-router';

/** What deleting for good is about to take: one batch, or the whole Trash. */
type Deleting = { batch: PrismTrashBatchInfo } | 'all';

/** What a batch holds, as its line says, once read. */
function BatchContents({ batchId }: { batchId: string }) {
  const { data, isError } = useQuery(batchContentsQuery(useLibrary(), batchId));
  if (isError) {
    return <span>Can’t read what it holds</span>;
  }
  if (!data) {
    return <span>Reading…</span>;
  }
  return (
    <span>
      {countsLabel(data)} · {formatSize(data.size)}
    </span>
  );
}

/** One batch: when its run was, what of, what it holds, and Put Back or delete it. */
function BatchRow({
  batch,
  busy,
  onPutBack,
  onDelete,
}: {
  batch: PrismTrashBatchInfo;
  busy: boolean;
  onPutBack: () => void;
  onDelete: () => void;
}) {
  const view = batchViewLabel(batch);
  return (
    <li className="border-separator flex items-center gap-4 border-b px-5 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{batchDateLabel(batch)}</span>
        <span className="text-label-secondary truncate text-sm">
          {view && `${view} · `}
          <BatchContents batchId={batch.id} />
        </span>
      </span>
      <Button disabled={busy || batch.trashedAt === null} onClick={onPutBack}>
        Put Back
      </Button>
      <Button disabled={busy} onClick={onDelete}>
        Delete Permanently…
      </Button>
    </li>
  );
}

/** Asks before deleting for good, with a red button, as anything that can't be undone gets. */
function ConfirmDelete({
  deleting,
  share,
  onConfirm,
  onClose,
}: {
  deleting: Deleting;
  share: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const all = deleting === 'all';
  return (
    <Dialog size="small" labelledBy={titleId} onClose={onClose}>
      <DialogTitle id={titleId}>
        {all ? `Empty Prism’s Trash on ${share}?` : 'Delete this batch permanently?'}
      </DialogTitle>
      <p className="text-label-secondary text-base">
        {all
          ? 'Everything in it is deleted for good. This can’t be undone.'
          : `What went to Prism’s Trash on ${batchDateLabel(deleting.batch)} is deleted for good. This can’t be undone.`}
      </p>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>
          {all ? 'Empty Trash' : 'Delete Permanently'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function resultText(data: PrismTrashActionResult) {
  if (data.intent === 'put-back-trash-batch') {
    return putBackText(data.result);
  }
  return data.result.error ?? null;
}

/**
 * Prism's Trash on the folder's share: its batches, newest first, each of which can be put back
 * where it came from or deleted for good, and Empty Trash for all of them.
 */
export function PrismTrashView() {
  const library = useLibrary();
  const { data: trash } = useSuspenseQuery(prismTrashQuery(library));
  const fetcher = useFetcher<PrismTrashActionResult>({ key: 'prism-trash' });
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const busy = fetcher.state !== 'idle';
  const toast = fetcher.state === 'idle' && fetcher.data ? resultText(fetcher.data) : null;
  function submit(intent: PrismTrashActionResult['intent'], batchId = '') {
    fetcher.submit({ batchId, intent }, { action: '/library', method: 'post' }).catch(() => null);
  }
  const batches = trash?.batches ?? [];
  return (
    <main className="bg-content-fade flex min-w-0 flex-1 flex-col" aria-busy={busy}>
      <Toolbar>
        <h1 className="text-md min-w-0 flex-1 truncate pl-2 font-semibold">
          {trash ? `Prism’s Trash on ${trash.share}` : 'Prism’s Trash'}
        </h1>
        {batches.length > 0 && (
          <Button disabled={busy} onClick={() => setDeleting('all')}>
            Empty Trash…
          </Button>
        )}
      </Toolbar>
      {batches.length === 0 ? (
        <EmptyState
          icon={<Trash2 size={32} />}
          title="Prism’s Trash is empty"
          description={
            trash
              ? 'What you move to the Trash on this share comes here, as the share has no Trash of its own.'
              : 'This folder isn’t on a network share, so what you move to the Trash goes to the system’s Trash.'
          }
        />
      ) : (
        <ul aria-label="Batches" className="min-h-0 flex-1 overflow-auto">
          {batches.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              busy={busy}
              onPutBack={() => submit('put-back-trash-batch', batch.id)}
              onDelete={() => setDeleting({ batch })}
            />
          ))}
        </ul>
      )}
      {deleting && trash && (
        <ConfirmDelete
          deleting={deleting}
          share={trash.share}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            setDeleting(null);
            if (deleting === 'all') {
              submit('empty-prism-trash');
            } else {
              submit('delete-trash-batch', deleting.batch.id);
            }
          }}
        />
      )}
      {toast && <Toast tone={fetcher.data?.result.error ? 'warning' : 'info'}>{toast}</Toast>}
    </main>
  );
}
