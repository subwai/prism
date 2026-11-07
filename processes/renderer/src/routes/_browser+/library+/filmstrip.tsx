import { AwaitGallery } from '#components/gallery/await-gallery';
import { FilmstripView } from '#components/gallery/filmstrip-view';
import { loadGallery } from '#data/route-loaders';
import type { Route } from '#types/routes/_browser+/library+/+types/filmstrip';

export { revalidateGallery as shouldRevalidate } from '#data/route-loaders';
export function clientLoader(args: Route.ClientLoaderArgs) {
  return loadGallery(args, 'filmstrip');
}
export default function Filmstrip({ loaderData: { gallery, trail } }: Route.ComponentProps) {
  // A new folder starts fresh; a refresh or re-sort of this one keeps selection and scroll.
  return (
    <AwaitGallery key={trail.at(-1)?.id} mode="filmstrip" trail={trail} gallery={gallery}>
      {(data) => <FilmstripView data={data} />}
    </AwaitGallery>
  );
}
