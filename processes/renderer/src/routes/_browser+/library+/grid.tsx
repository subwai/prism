import { Gallery } from '#photos/components/gallery';
import { loadGallery } from '#photos/data/route-loaders';
import type { Route } from '#types/routes/_browser+/library+/+types/grid';

export { revalidateGallery as shouldRevalidate } from '#photos/data/route-loaders';
export function clientLoader(args: Route.ClientLoaderArgs) {
  return loadGallery(args, 'grid');
}
export default function Grid({ loaderData }: Route.ComponentProps) {
  return <Gallery key={loaderData.scan.key} data={loaderData} mode="grid" />;
}
