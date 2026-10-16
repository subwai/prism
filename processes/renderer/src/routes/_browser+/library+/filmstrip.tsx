import { Gallery } from '#photos/components/gallery';
import { loadGallery } from '#photos/data/route-loaders';
import type { Route } from '#types/routes/_browser+/library+/+types/filmstrip';

export { revalidateGallery as shouldRevalidate } from '#photos/data/route-loaders';
export function clientLoader(args: Route.ClientLoaderArgs) {
  return loadGallery(args, 'filmstrip');
}
export default function Filmstrip({ loaderData }: Route.ComponentProps) {
  // A new folder starts fresh; a refresh or re-sort of this one keeps selection and scroll.
  return <Gallery key={loaderData.trail.at(-1)?.id} data={loaderData} mode="filmstrip" />;
}
