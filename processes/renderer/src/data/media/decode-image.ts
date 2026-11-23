/** Resolves once the image at `url` has loaded and decoded, so it can paint at once. */
export async function decodeImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
}
