// Builds the CloudTrain brand assets. Source of truth: apps/web/public/brand/*.svg (served at /brand/).
//
//   node apps/web/scripts/brand-assets.mjs --import <dir>   # optimise the designer's SVGs into public/brand
//   node apps/web/scripts/brand-assets.mjs                  # rasterise favicons, PWA icons and social images
//
// --import strips the C2PA <metadata> manifest and the fixed width/height (the viewBox stays), and adds
// a <title> with role="img" so the files are accessible on their own. Path data is copied verbatim.
// The raster step needs sharp (devDependency of apps/web) and writes, next to the SVGs:
//   favicon.svg (mark, follows prefers-color-scheme), ../favicon.ico (16/32/48),
//   apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-192.png, icon-maskable-512.png,
//   og-image.png (1200x630), github-social-preview.png (1280x640), github-avatar.png (1024).
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const brandDir = path.join(publicDir, 'brand');

const INK = '#111111';
const PAPER = '#FFFFFF';

const TITLES = {
  'cloudtrain-icon': 'CloudTrain mark',
  'cloudtrain-icon-white': 'CloudTrain mark',
  'cloudtrain-wordmark': 'CloudTrain',
  'cloudtrain-wordmark-white': 'CloudTrain',
  'cloudtrain-horizontal': 'CloudTrain',
  'cloudtrain-horizontal-white': 'CloudTrain',
  'cloudtrain-stacked': 'CloudTrain',
  'cloudtrain-stacked-white': 'CloudTrain',
  'cloudtrain-appicon-dark': 'CloudTrain app icon',
  'cloudtrain-appicon-light': 'CloudTrain app icon',
};

/** Strips metadata and fixed size, keeps the drawing untouched, adds an accessible title. */
function optimise(name, svg) {
  const title = TITLES[name];
  if (!title) throw new Error(`unexpected brand file ${name}.svg (add it to TITLES)`);
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) throw new Error(`${name}.svg: no <svg> element`);
  const viewBox = open[0].match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error(`${name}.svg: no viewBox`);
  let body = svg.slice(open.index + open[0].length).replace(/<\/svg>\s*$/, '');
  body = body.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
  if (/<(script|foreignObject|image)\b|\bon[a-z]+=|javascript:/i.test(body)) throw new Error(`${name}.svg: active content`);
  const elements = body
    .replace(/><\/(path|rect|circle|g)>/g, '/>')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const id = `${name}-title`;
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="${id}">`, `  <title id="${id}">${title}</title>`, ...elements.map((e) => `  ${e}`), '</svg>', ''].join('\n');
}

async function importSvgs(from) {
  await mkdir(brandDir, { recursive: true });
  const files = (await readdir(from)).filter((f) => f.endsWith('.svg')).sort();
  if (!files.length) throw new Error(`no .svg files in ${from}`);
  for (const f of files) {
    const name = f.replace(/\.svg$/, '');
    const out = optimise(name, await readFile(path.join(from, f), 'utf8'));
    await writeFile(path.join(brandDir, f), out);
    console.log('wrote', path.relative(process.cwd(), path.join(brandDir, f)), `${out.length} bytes`);
  }
}

/** The mark's path and viewBox from the optimised icon file. */
async function readMark() {
  const svg = await readFile(path.join(brandDir, 'cloudtrain-icon.svg'), 'utf8');
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const d = svg.match(/ d="([^"]+)"/)[1];
  return { d, w: viewBox[2], h: viewBox[3] };
}

async function readLockup(name) {
  const svg = await readFile(path.join(brandDir, `${name}.svg`), 'utf8');
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const paths = [...svg.matchAll(/<path\b[^>]*\/>/g)].map((m) => m[0]);
  return { paths, w: viewBox[2], h: viewBox[3] };
}

/** The app icon at a pixel size: the mark on a tile (cloudtrain-appicon-dark.svg proportions, 1024 grid). */
function tileSvg(mark, size, { radius = 230, ink = INK, paper = PAPER } = {}) {
  // appicon-*.svg: translate(225 316.2) scale(1.73) of the 332.3x226.7 mark
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">
  <rect width="1024" height="1024" rx="${radius}" fill="${ink}"/>
  <path fill="${paper}" fill-rule="evenodd" transform="translate(225 316.2) scale(1.73)" d="${mark.d}"/>
</svg>`;
}

/** Social card: the horizontal white lockup centred on the brand ink. */
function cardSvg(lockup, width, height, logoWidth) {
  const scale = logoWidth / lockup.w;
  const x = (width - logoWidth) / 2;
  const y = (height - lockup.h * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${INK}"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})">
    ${lockup.paths.join('\n    ')}
  </g>
</svg>`;
}

/** favicon.svg: the bare mark, ink on light tabs and paper on dark ones. */
function faviconSvg(mark) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.w} ${mark.h}" role="img" aria-labelledby="favicon-title">
  <title id="favicon-title">CloudTrain</title>
  <style>path{fill:${INK}}@media (prefers-color-scheme:dark){path{fill:${PAPER}}}</style>
  <path fill-rule="evenodd" d="${mark.d}"/>
</svg>
`;
}

/** ICO container with one PNG image per size (PNG entries are supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // colour palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.png)]);
}

async function rasterise() {
  const { default: sharp } = await import('sharp');
  const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const mark = await readMark();
  const horizontalWhite = await readLockup('cloudtrain-horizontal-white');
  const write = async (rel, buf) => {
    await writeFile(path.join(publicDir, rel), buf);
    console.log('wrote', path.relative(process.cwd(), path.join(publicDir, rel)), `${buf.length} bytes`);
  };

  await write('brand/favicon.svg', faviconSvg(mark));
  const icoSizes = [16, 32, 48];
  await write('favicon.ico', ico(await Promise.all(icoSizes.map(async (size) => ({ size, png: await png(tileSvg(mark, size)) })))));
  // iOS masks the icon itself, so it gets square corners; the same for the GitHub avatar.
  await write('brand/apple-touch-icon.png', await png(tileSvg(mark, 180, { radius: 0 })));
  await write('brand/github-avatar.png', await png(tileSvg(mark, 1024, { radius: 0 })));
  for (const size of [192, 512]) {
    await write(`brand/icon-${size}.png`, await png(tileSvg(mark, size)));
    // maskable: full bleed; the mark sits well inside the 80% safe zone
    await write(`brand/icon-maskable-${size}.png`, await png(tileSvg(mark, size, { radius: 0 })));
  }
  await write('brand/og-image.png', await png(cardSvg(horizontalWhite, 1200, 630, 720)));
  await write('brand/github-social-preview.png', await png(cardSvg(horizontalWhite, 1280, 640, 780)));
}

const from = arg('import', '');
if (from) await importSvgs(path.resolve(from));
else await rasterise();
