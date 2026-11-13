import { type PlanState, type SheetMode, usePlanState } from '#components/trash/plan-state';
import { SheetFooter } from '#components/trash/sheet-footer';
import { ConfirmTrash } from '#components/trash/trash-confirm';
import { DecideView } from '#components/trash/trash-decide';
import { TrashExplainer } from '#components/trash/trash-explainer';
import { FilesView } from '#components/trash/trash-files';
import { formatSize } from '#data/entries';
import type { GalleryView } from '#data/gallery-view';
import { trashPlaceQuery } from '#data/prism-trash';
import { destinationLine, itemCount, narrowedBy, trashAction, trashSpecOf } from '#data/trash';
import { useViewState } from '#hooks/use-gallery-view';
import { useLibrary } from '#hooks/use-library';
import { ChoiceToggle, cn, Dialog, IconButton, LoadingState, Spinner } from '@prism/design-system';
import type { TrashPlace, TrashPlan, ViewSpec, ViewState } from '@prism/shared';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Info, TriangleAlert } from 'lucide-react';
import { Suspense, use, useId } from 'react';

const MODES: { value: SheetMode; label: string }[] = [
  { label: 'Decide', value: 'decide' },
  { label: 'Files', value: 'files' },
];

/** What the plan moves in all, how the sheet shows it, and the way to have it explained. */
function Summary({
  data,
  state,
  plan,
  place,
}: {
  data: TrashPlan;
  state: ViewState;
  plan: PlanState;
  place: TrashPlace;
}) {
  const total = itemCount(data.totals);
  const rescued = itemCount(data.rescued);
  return (
    <>
      <div className="flex items-center gap-3 px-5 pb-3">
        <p className="text-label-secondary text-sm">
          {total.toLocaleString()} {total === 1 ? 'item' : 'items'} · {formatSize(data.totals.size)}{' '}
          {place.destination === 'delete' ? 'to delete' : 'to the Trash'}
          {rescued > 0 && ` · ${rescued.toLocaleString()} rescued`}
        </p>
        <span className="ml-auto flex items-center gap-2">
          <ChoiceToggle
            label="Show the plan as"
            choices={MODES}
            value={plan.explaining ? null : plan.mode}
            onChange={(mode) => plan.setMode(mode)}
          />
          <IconButton
            label="How this works"
            pressed={plan.explaining}
            onClick={() => plan.setExplaining(!plan.explaining)}
          >
            <Info />
          </IconButton>
        </span>
      </div>
      {(state.loading || state.unread > 0) && (
        <p role="status" className="text-label-secondary flex items-center gap-2 px-5 pb-3 text-sm">
          <Spinner />
          {state.loading
            ? 'Reading the folders inside…'
            : `Reading the ratings of ${state.unread.toLocaleString()} more photos…`}
        </p>
      )}
    </>
  );
}

/** The plan of `view`, once the worker has made it, made again as the person decides. */
function Plan({
  view,
  spec,
  place,
  folderName,
  onClose,
}: {
  view: GalleryView;
  spec: ViewSpec;
  place: TrashPlace;
  folderName: string;
  onClose: () => void;
}) {
  const state = useViewState(view);
  const plan = usePlanState();
  const { data, isPlaceholderData } = useQuery(view.trashPlanQuery(state.version, plan.choices));
  if (!data) {
    return <LoadingState label="Working out what goes…" />;
  }
  const confirm = (
    <ConfirmTrash
      view={view}
      version={state.version}
      choices={plan.choices}
      place={place}
      items={itemCount(data.totals)}
      // A plan of every rating, of the choices as they are now.
      ready={!isPlaceholderData && !state.loading && state.unread === 0}
      onDone={onClose}
    />
  );
  let shown;
  if (plan.explaining) {
    shown = (
      <>
        <TrashExplainer
          data={data}
          choices={plan.choices}
          narrowed={narrowedBy(spec)}
          folderName={folderName}
        />
        <SheetFooter confirm={confirm} onClose={onClose} />
      </>
    );
  } else if (plan.mode === 'files') {
    shown = (
      <FilesView
        view={view}
        version={state.version}
        plan={plan}
        filter={spec.filter}
        folderName={folderName}
        confirm={confirm}
        onClose={onClose}
      />
    );
  } else {
    shown = (
      <DecideView
        data={data}
        plan={plan}
        filter={spec.filter}
        folderName={folderName}
        confirm={confirm}
        onClose={onClose}
      />
    );
  }
  return (
    <>
      <Summary data={data} state={state} plan={plan} place={place} />
      {shown}
    </>
  );
}

function OpenPlan({
  spec,
  folderName,
  titleId,
  onClose,
}: {
  spec: ViewSpec;
  folderName: string;
  titleId: string;
  onClose: () => void;
}) {
  const library = useLibrary();
  // Where it goes is settled before the sheet shows, and the run refuses to go anywhere else.
  const { data: place } = useSuspenseQuery(trashPlaceQuery(library));
  const deletes = place.destination === 'delete';
  return (
    <>
      <h2 id={titleId} className="text-md truncate px-5 pt-4 font-semibold">
        {trashAction(place)} — {narrowedBy(spec)} in “{folderName}”
      </h2>
      <p
        className={cn(
          'flex items-center gap-1.5 px-5 pb-1 text-sm',
          deletes ? 'text-danger' : 'text-label-secondary',
        )}
      >
        {deletes && <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}
        {destinationLine(place)}
      </p>
      <Plan
        view={use(library.view(trashSpecOf(spec)))}
        spec={spec}
        place={place}
        folderName={folderName}
        onClose={onClose}
      />
    </>
  );
}

/**
 * What moving the matches of `spec` to the Trash would do, over the view: everything inside its
 * folder that matches, at every depth, as rows to decide on, one click each or many at once, or
 * as every file that goes, one by one. Where Prism can keep no Trash, they are deleted for good,
 * which it says first.
 */
export function TrashSheet({
  spec,
  folderName,
  onClose,
}: {
  spec: ViewSpec;
  folderName: string;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Dialog labelledBy={titleId} onClose={onClose}>
      <Suspense fallback={<LoadingState label="Opening…" />}>
        <OpenPlan spec={spec} folderName={folderName} titleId={titleId} onClose={onClose} />
      </Suspense>
    </Dialog>
  );
}
