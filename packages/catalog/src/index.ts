// A scope is the folders a view or query covers: one folder, or it and every folder inside it.

export { threadHost } from '#threads/channels';
export type { CatalogActivity } from '#threads/busy-change';
export { Catalog } from '#threads/client';
export type { CatalogFiles } from '#database/connections';
export type { UnreadableFile, UnreadPhoto } from '#repositories/entries/details';
export type { FolderTimes } from '#repositories/indexed-folders';
export type { CatalogEntry } from '#repositories/entries/entries';
export type { FullReads } from '#repositories/libraries';
export type { Scope } from '#repositories/queries/scope';
export { type CatalogAPI, type HostRole, openHost } from '#threads/host';
export { INDEX_FILE_NAME, prepareIndex } from '#database/photo-index/open';
export { prepareRatings, RATINGS_FILE_NAME } from '#database/ratings/open';
export type { PhotoFile, ReadDetails } from '#services/details/reusable-details';
export type { ViewFile } from '#services/views/view-files';
export type { ViewFileRange, ViewVersion } from '#services/views/catalog-views';
export type { CatalogWrite } from '#services/writes/write-catalog';
