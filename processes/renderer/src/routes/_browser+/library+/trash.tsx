import { PrismTrashView } from '#components/trash/prism-trash-view';
import { loadLibrary } from '#data/session';
import { prismTrashQuery } from '#data/trash/prism-trash';

/** Prism's Trash on the folder's share; putting back and deleting go through the library's action. */
export async function clientLoader() {
  const library = await loadLibrary();
  await library.queries.ensureQueryData(prismTrashQuery(library));
  return null;
}

export default function Trash() {
  return <PrismTrashView />;
}
