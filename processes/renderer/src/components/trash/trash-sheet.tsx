import { type PlanState, type SheetMode, usePlanState } from '#components/trash/plan-state';
import { SheetFooter } from '#components/trash/sheet-footer';
import { DecideView } from '#components/trash/trash-decide';
import { TrashExplainer } from '#components/trash/trash-explainer';
import { FilesView } from '#components/trash/trash-files';
import { formatSize } from '#data/entries';
import type { GalleryView } from '#data/gallery-view';
import { itemCount, narrowedBy, trashSpecOf } from '#data/trash';
import { useViewState } from '#hooks/use-gallery-view';
import { useLibrary } from '#hooks/use-library';
import { ChoiceToggle, Dialog, IconButton, LoadingState, Spinner } from '@prism/design-system';
import type { TrashPlan, ViewSpec, ViewState } from '@prism/shared';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { Suspense, use, useId } from 'react';

const MODES: { value: SheetMode; label: string }[] = [
  { label: 'Decide', value: 'decide' },
  { label: 'Files', value: 'files' },
];

/** What the plan moves in all, how the sheet shows it, and the way to have it explained. */
function Summary({ data, state, plan }: { data: TrashPlan; state: ViewState; plan: PlanState }) {
  const total = itemCount(data.totals);
  const rescued = itemCount(data.rescued);
  return (
    <>
      <div className="flex items-center gap-3 px-5 pb-3">
        <p className="text-label-secondary text-sm">
          {total.toLocaleString()} {total === 1 ? 'item' : 'items'} · {formatSize(data.totals.size)}{' '}
          to the Trash
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
  folderName,
  onClose,
}: {
  view: GalleryView;
  spec: ViewSpec;
  folderName: string;
  onClose: () => void;
}) {
  const state = useViewState(view);
  const plan = usePlanState();
  const { data } = useQuery(view.trashPlanQuery(state.version, plan.choices));
  if (!data) {
    return <LoadingState label="Working out what goes…" />;
  }
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
        <SheetFooter onClose={onClose} />
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
        onClose={onClose}
      />
    );
  }
  return (
    <>
      <Summary data={data} state={state} plan={plan} />
      {shown}
    </>
  );
}

function OpenPlan({
  spec,
  folderName,
  onClose,
}: {
  spec: ViewSpec;
  folderName: string;
  onClose: () => void;
}) {
  const library = useLibrary();
  return (
    <Plan
      view={use(library.view(trashSpecOf(spec)))}
      spec={spec}
      folderName={folderName}
      onClose={onClose}
    />
  );
}

/**
 * What moving the matches of `spec` to the Trash would do, over the view: everything inside its
 * folder that matches, at every depth, as rows to decide on, one click each or many at once, or
 * as every file that goes, one by one.
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
      <h2 id={titleId} className="text-md truncate px-5 pt-4 pb-1 font-semibold">
        Move to Trash — {narrowedBy(spec)} in “{folderName}”
      </h2>
      <Suspense fallback={<LoadingState label="Opening…" />}>
        <OpenPlan spec={spec} folderName={folderName} onClose={onClose} />
      </Suspense>
    </Dialog>
  );
}
