import { AwaitGallery } from '#components/gallery/await-gallery';
import { GridView } from '#components/gallery/grid-view';
import { loadGallery } from '#data/route-loaders';
import type { Route } from '#types/routes/_browser+/library+/+types/grid';

export { revalidateGallery as shouldRevalidate } from '#data/route-loaders';
export function clientLoader(args: Route.ClientLoaderArgs) {
  return loadGallery(args, 'grid');
}
export default function Grid({ loaderData: { gallery, trail } }: Route.ComponentProps) {
  // A new folder starts fresh; a refresh or re-sort of this one keeps selection and scroll.
  return (
    <AwaitGallery key={trail.at(-1)?.id} mode="grid" trail={trail} gallery={gallery}>
      {(data) => <GridView data={data} />}
    </AwaitGallery>
  );
}
