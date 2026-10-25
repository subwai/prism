import { ReaderView } from '#components/gallery/reader-view';
import { loadGallery } from '#data/route-loaders';
import type { Route } from '#types/routes/_browser+/library+/+types/reader';

export { revalidateGallery as shouldRevalidate } from '#data/route-loaders';
export function clientLoader(args: Route.ClientLoaderArgs) {
  return loadGallery(args, 'reader');
}
export default function Reader({ loaderData }: Route.ComponentProps) {
  // A new folder opens at its first page; a refresh or re-sort of this one keeps the scroll.
  return <ReaderView key={loaderData.trail.at(-1)?.id} data={loaderData} />;
}
