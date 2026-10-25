import { GridView } from '#photos/components/grid-view';
import { loadGallery } from '#photos/data/route-loaders';
import type { Route } from '#types/routes/_browser+/library+/+types/grid';

export { revalidateGallery as shouldRevalidate } from '#photos/data/route-loaders';
export function clientLoader(args: Route.ClientLoaderArgs) {
  return loadGallery(args, 'grid');
}
export default function Grid({ loaderData }: Route.ComponentProps) {
  // A new folder starts fresh; a refresh or re-sort of this one keeps selection and scroll.
  return <GridView key={loaderData.trail.at(-1)?.id} data={loaderData} />;
}
