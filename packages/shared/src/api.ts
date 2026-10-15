import type { PhotosAPI } from '#photos';

export interface AppAPI {
  ping: () => Promise<string>;
  photos: PhotosAPI;
}
