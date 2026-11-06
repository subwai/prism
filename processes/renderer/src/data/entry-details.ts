import type { PhotoEntry, PhotoExif, PhotoMetadata } from '@prism/shared';

/** Asks for what each of `ids` lacks, keeping in `found` what the worker answers. */
export async function askFor<Answer>(
  ask: (ids: string[]) => Promise<(Answer | null)[]>,
  ids: string[],
  found: Map<string, Answer>,
) {
  const answers = ids.length > 0 ? await ask(ids) : [];
  for (const [index, id] of ids.entries()) {
    const answer = answers[index];
    if (answer) {
      found.set(id, answer);
    }
  }
}

/** `entry` with the metadata and EXIF details it lacked, from those read for it. */
export function filled(
  entry: PhotoEntry,
  metadata: Map<string, PhotoMetadata>,
  exif: Map<string, PhotoExif>,
): PhotoEntry {
  const read = {
    exif: entry.exif ? undefined : exif.get(entry.id),
    metadata: entry.metadata ? undefined : metadata.get(entry.id),
  };
  return read.exif || read.metadata
    ? { ...entry, exif: read.exif ?? entry.exif, metadata: read.metadata ?? entry.metadata }
    : entry;
}
