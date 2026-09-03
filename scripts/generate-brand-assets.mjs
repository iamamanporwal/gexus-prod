// Generates every GEXUS brand asset from the letterforms in brand-geometry.mjs:
//
//   public/gexus-wordmark.svg       the full lockup, for headers and pages
//   public/gexus-mark.svg           bare G monogram, for avatars and the icon rail
//   public/gexus-icon.svg           G on a dark tile, for the favicon
//   public/gexus-icon.ico           the same tile, rasterised at 16/32/48/64/256
//   public/gexus-mark.png           512px tile, for desktop notification icons
//   src/utils/gexusMark.ts          the monogram path, for inline SVG in React
//   src/utils/gexusLogoVertices.ts  the wordmark as a 3D point cloud
//
// Rasterising happens here rather than at build time because the repo has no
// SVG rasteriser installed (no sharp, no ImageMagick) and the notification and
// .ico paths genuinely need bitmaps. Everything is derived analytically from
// the same distance field, so the PNGs can never disagree with the SVGs.
//
// Run with: node scripts/generate-brand-assets.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BOX,
  GLYPH_PATHS,
  GLYPH_SHAPES,
  MARK_STROKE,
  STROKE,
  WORD,
  WORDMARK_WIDTH,
  arcRadii,
  distanceToShape,
  glyphOffset,
} from './brand-geometry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (name) => join(root, 'public', name);

const INK = '#F1F1F1'; // the off-white the rest of the UI's text already uses
const TILE = '#111111'; // adam-neutral-950, so the tile reads on any chrome

// --- SVG -------------------------------------------------------------------

const strokeAttrs = (width) =>
  `fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="butt" stroke-linejoin="miter"`;

function wordmarkSvg() {
  const glyphs = WORD.map(
    (letter, i) =>
      `  <path transform="translate(${glyphOffset(i)} 0)" d="${GLYPH_PATHS[letter]}"/>`,
  ).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WORDMARK_WIDTH}" height="${BOX}" viewBox="0 0 ${WORDMARK_WIDTH} ${BOX}" role="img" aria-label="GEXUS">
 <g ${strokeAttrs(STROKE)}>
${glyphs}
 </g>
</svg>
`;
}

// The monogram runs a heavier stroke, so its outer edge overhangs the 100 grid
// by half the extra weight — the viewBox is padded to match.
const PAD = (MARK_STROKE - STROKE) / 2;

function markSvg() {
  const size = BOX + 2 * PAD;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-PAD} ${-PAD} ${size} ${size}" role="img" aria-label="GEXUS">
 <path ${strokeAttrs(MARK_STROKE)} d="${GLYPH_PATHS.G}"/>
</svg>
`;
}

// The favicon has to hold up against light and dark browser chrome, so there
// the monogram sits on a tile rather than floating as bare white strokes.
const TILE_MARGIN = 22;
const TILE_SIZE = BOX + 2 * TILE_MARGIN;
const TILE_RADIUS = TILE_SIZE * 0.22;

function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}" role="img" aria-label="GEXUS">
 <rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}" fill="${TILE}"/>
 <path transform="translate(${TILE_MARGIN} ${TILE_MARGIN})" ${strokeAttrs(MARK_STROKE)} d="${GLYPH_PATHS.G}"/>
</svg>
`;
}

// --- Raster ----------------------------------------------------------------

const hexToRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const INK_RGB = hexToRgb(INK);
const TILE_RGB = hexToRgb(TILE);

const SUPERSAMPLE = 4; // 4x4 per pixel; shapes this simple need nothing cleverer

function insideRoundedRect(x, y) {
  if (x < 0 || y < 0 || x > TILE_SIZE || y > TILE_SIZE) return false;
  const dx = Math.max(TILE_RADIUS - x, x - (TILE_SIZE - TILE_RADIUS), 0);
  const dy = Math.max(TILE_RADIUS - y, y - (TILE_SIZE - TILE_RADIUS), 0);
  return dx * dx + dy * dy <= TILE_RADIUS * TILE_RADIUS;
}

/**
 * Renders the tiled monogram at `size` px as raw RGBA, antialiased by
 * supersampling the analytic distance field.
 */
function renderIconRgba(size) {
  const scale = TILE_SIZE / size; // glyph units per pixel
  const half = MARK_STROKE / 2;
  const total = SUPERSAMPLE * SUPERSAMPLE;
  const px = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let ink = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const cx = (x + (sx + 0.5) / SUPERSAMPLE) * scale;
          const cy = (y + (sy + 0.5) / SUPERSAMPLE) * scale;
          if (insideRoundedRect(cx, cy)) {
            tile++;
          }
          let d = Infinity;
          for (const shape of GLYPH_SHAPES.G) {
            d = Math.min(
              d,
              distanceToShape(shape, cx - TILE_MARGIN, cy - TILE_MARGIN),
            );
          }
          if (d <= half) {
            ink++;
          }
        }
      }
      const alpha = tile / total;
      const inkMix = ink / total;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(
          TILE_RGB[c] * (1 - inkMix) + INK_RGB[c] * inkMix,
        );
      }
      px[i + 3] = Math.round(255 * alpha);
    }
  }
  return px;
}

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes RGBA pixels as an 8-bit truecolour-with-alpha PNG. */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Bytes 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Filter type 0 (none) ahead of every scanline. These images are small and
  // already compress well, so a smarter filter would not earn its complexity.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Wraps PNGs in an ICO container (PNG-in-ICO, which every current browser reads). */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    dir[at] = size >= 256 ? 0 : size; // 0 means 256
    dir[at + 1] = size >= 256 ? 0 : size;
    dir[at + 2] = 0; // palette size
    dir[at + 3] = 0; // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --- the monogram as a module ----------------------------------------------

// Loader.tsx needs the G inline rather than behind an <img>, so it can animate
// the stroke. Emitting it here stops that copy drifting from the .svg files.
function markModule() {
  const size = BOX + 2 * PAD;
  const lines = [
    '// The GEXUS monogram as SVG path data, for drawing the mark inline.',
    '//',
    '// GENERATED — do not hand-edit. Run `node scripts/generate-brand-assets.mjs`',
    '// to rebuild it from the letterforms in scripts/brand-geometry.mjs.',
    '',
    '/** Padded for the stroke width, so the mark is not clipped at the edges. */',
    `export const GEXUS_MARK_VIEWBOX = '${-PAD} ${-PAD} ${size} ${size}';`,
    '',
    `export const GEXUS_MARK_STROKE = ${MARK_STROKE};`,
    '',
    `export const GEXUS_MARK_PATH = '${GLYPH_PATHS.G}';`,
    '',
  ];
  return lines.join('\n');
}

// --- 3D point cloud --------------------------------------------------------

const CLOUD_HALF_WIDTH = 1.7; // fills GlbPreview's fixed camera without clipping
const CLOUD_LANES = [-0.34, 0, 0.34]; // fractions of the stroke width, across it
const CLOUD_DEPTH = 0.06; // a little extrusion, so the auto-rotate reads as 3D
const CLOUD_SPACING = 1.6; // distance between points along a stroke, glyph units

// The z jitter needs to be random-looking but not actually random: the cloud is
// a checked-in file, so a fresh Math.random() on every run would churn all 2400
// lines of it for no visual change. mulberry32 off a fixed seed is reproducible.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walks every stroke of the wordmark and emits evenly spaced points. */
function wordmarkVertices() {
  const scale = (2 * CLOUD_HALF_WIDTH) / WORDMARK_WIDTH;
  const random = mulberry32(0x67657875); // "gexu"
  const out = [];

  // (nx, ny) is the unit normal across the stroke, so the lanes fan out to
  // either side of the centreline and the strokes gain their weight.
  const emit = (x, y, nx, ny) => {
    for (const lane of CLOUD_LANES) {
      const off = lane * STROKE;
      out.push(
        (x + nx * off) * scale,
        // y is negated: SVG grows downward, the scene grows upward.
        -(y + ny * off) * scale,
        (random() * 2 - 1) * CLOUD_DEPTH,
      );
    }
  };

  WORD.forEach((letter, i) => {
    const dx = glyphOffset(i);
    for (const shape of GLYPH_SHAPES[letter]) {
      if (shape.a) {
        const [ax, ay] = shape.a;
        const [bx, by] = shape.b;
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.round(len / CLOUD_SPACING));
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          emit(dx + ax + (bx - ax) * t, ay + (by - ay) * t, -uy, ux);
        }
      } else {
        const [cx, cy] = shape.c;
        const { rx, ry } = arcRadii(shape);
        const span = ((shape.to - shape.from) * Math.PI) / 180;
        // Step count from the outer radius, so the flat ends of an ellipse are
        // sampled at least as densely as the rest of it rather than sparsely.
        const steps = Math.max(
          1,
          Math.round((Math.abs(span) * Math.max(rx, ry)) / CLOUD_SPACING),
        );
        for (let s = 0; s <= steps; s++) {
          const t = (shape.from * Math.PI) / 180 + span * (s / steps);
          // The normal to an ellipse is not radial: it comes from rotating the
          // tangent (-rx sin t, ry cos t), which for a circle reduces to the
          // radial case anyway.
          const len = Math.hypot(ry * Math.cos(t), rx * Math.sin(t));
          const nx = (ry * Math.cos(t)) / len;
          const ny = (rx * Math.sin(t)) / len;
          emit(dx + cx + rx * Math.cos(t), cy + ry * Math.sin(t), nx, ny);
        }
      }
    }
  });

  return out;
}

function verticesModule(vertices) {
  const rows = [];
  for (let i = 0; i < vertices.length; i += 3) {
    rows.push(
      `  ${vertices
        .slice(i, i + 3)
        .map((n) => n.toFixed(4))
        .join(', ')},`,
    );
  }
  return `// The GEXUS wordmark as a point cloud, held in GlbPreview while a mesh loads.
//
// GENERATED — do not hand-edit. Run \`node scripts/generate-brand-assets.mjs\`
// to rebuild it from the letterforms in scripts/brand-geometry.mjs.
//
// Flat triples of x, y, z. The scale suits GlbPreview's fixed camera (z = 5,
// 45 degree field of view), and the shallow z spread is what makes the slow
// auto-rotate read as depth rather than as a flat sheet.
export const gexusLogoVertices = [
${rows.join('\n')}
];
`;
}

// --- Run -------------------------------------------------------------------

writeFileSync(pub('gexus-wordmark.svg'), wordmarkSvg());
writeFileSync(pub('gexus-mark.svg'), markSvg());
writeFileSync(pub('gexus-icon.svg'), iconSvg());

const icoSizes = [16, 32, 48, 64, 256];
const rendered = new Map(
  [...icoSizes, 512].map((size) => [
    size,
    encodePng(renderIconRgba(size), size),
  ]),
);
writeFileSync(
  pub('gexus-icon.ico'),
  encodeIco(icoSizes.map((size) => ({ size, png: rendered.get(size) }))),
);
writeFileSync(pub('gexus-mark.png'), rendered.get(512));

writeFileSync(join(root, 'src', 'utils', 'gexusMark.ts'), markModule());

const vertices = wordmarkVertices();
writeFileSync(
  join(root, 'src', 'utils', 'gexusLogoVertices.ts'),
  verticesModule(vertices),
);

console.log(
  `wordmark ${WORDMARK_WIDTH}x${BOX} · ico ${icoSizes.join('/')} · png 512 · cloud ${vertices.length / 3} points`,
);
