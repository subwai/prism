import path from 'node:path';
import sharp from 'sharp';

// Renders the app icons from their vector layers, kept with the design system's brand artwork.
// Windows and Linux use a full-bleed circle; macOS uses the margin, corners and shadow of Apple's
// icon template.
const SIZE = 1024,
  LAYERS = ['background.svg', 'light.svg', 'prism.svg', 'gloss.svg'],
  // A glass edge, lit along the top and fading out down the sides.
  RIM = `<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.3"/>
      <stop offset="0.4" stop-color="#fff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.06"/>
    </linearGradient>`,
  RIM_WIDTH = 4,
  // Apple's macOS icon grid: an 824-point rounded square centred on a 1024-point canvas.
  MAC_SHAPE = 824,
  MAC_RADIUS = 185.4,
  MAC_SHADOW = { blur: 10, offset: 10, opacity: 0.3 },
  root = path.resolve(import.meta.dirname, '..'),
  source = path.join(root, 'packages/design-system/src/brand');

function svg(body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${body}</svg>`,
  );
}

async function artwork(shape: string): Promise<Buffer> {
  const [first, ...rest] = LAYERS.map((layer) => path.join(source, layer));
  return await sharp(first)
    .composite([
      ...rest.map((input) => ({ input })),
      // The mask cuts the stroke in half, leaving its inner side.
      {
        input: svg(
          `<defs>${RIM}</defs><g fill="none" stroke="url(#rim)" stroke-width="${RIM_WIDTH * 2}">${shape}</g>`,
        ),
      },
      { blend: 'dest-in' as const, input: svg(shape) },
    ])
    .png()
    .toBuffer();
}

async function renderCircle(): Promise<void> {
  const half = SIZE / 2;
  await sharp(await artwork(`<circle cx="${half}" cy="${half}" r="${half}"/>`))
    .png()
    .toFile(path.join(root, 'resources/icon.png'));
}

async function renderMac(): Promise<void> {
  const radius = (MAC_RADIUS * SIZE) / MAC_SHAPE,
    inset = (SIZE - MAC_SHAPE) / 2,
    shape = await sharp(await artwork(`<rect width="${SIZE}" height="${SIZE}" rx="${radius}"/>`))
      .resize(MAC_SHAPE)
      .toBuffer(),
    shadow = `<filter id="shadow"><feGaussianBlur stdDeviation="${MAC_SHADOW.blur}"/></filter>
      <rect x="${inset}" y="${inset + MAC_SHADOW.offset}" width="${MAC_SHAPE}" height="${MAC_SHAPE}"
        rx="${MAC_RADIUS}" fill-opacity="${MAC_SHADOW.opacity}" filter="url(#shadow)"/>`;
  await sharp(svg(shadow))
    .composite([{ input: shape, left: inset, top: inset }])
    .png()
    .toFile(path.join(root, 'resources/icon-mac.png'));
}

await Promise.all([renderCircle(), renderMac()]);
