import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Container / metadata inspection
//
// Metadata removal must be proven against the real container structure, not by
// searching for the literal string "GPS" (GPS tag numbers are binary). The
// helpers below walk the actual JPEG segments, PNG chunks and RIFF chunks.
// ---------------------------------------------------------------------------

export interface JpegSegment {
  marker: number;
  /** Printable prefix of the segment payload, for identification only. */
  identifier: string;
}

export function jpegSegments(buffer: Buffer): JpegSegment[] {
  const out: JpegSegment[] = [];
  let i = 2;
  while (i + 4 <= buffer.length && buffer[i] === 0xff) {
    const marker = buffer[i + 1] as number;
    if (marker === 0xda) {
      out.push({ marker, identifier: 'SOS' });
      break;
    }
    const len = buffer.readUInt16BE(i + 2);
    const identifier = buffer
      .toString('latin1', i + 4, Math.min(i + 2 + len, i + 24))
      .replace(/[^\x20-\x7e]/g, '.');
    out.push({ marker, identifier });
    i += 2 + len;
  }
  return out;
}

/** Payload of the APP1 "Exif" segment of a JPEG, if present. */
export function jpegExifPayload(buffer: Buffer): Buffer | undefined {
  let i = 2;
  while (i + 4 <= buffer.length && buffer[i] === 0xff) {
    const marker = buffer[i + 1] as number;
    if (marker === 0xda) return undefined;
    const len = buffer.readUInt16BE(i + 2);
    if (marker === 0xe1) {
      const data = buffer.subarray(i + 4, i + 2 + len);
      if (data.subarray(0, 4).toString('latin1') === 'Exif') return data;
    }
    i += 2 + len;
  }
  return undefined;
}

export const jpegHasExif = (buffer: Buffer): boolean =>
  jpegSegments(buffer).some(
    (segment) => segment.marker === 0xe1 && segment.identifier.startsWith('Exif'),
  );

export const jpegHasXmp = (buffer: Buffer): boolean =>
  jpegSegments(buffer).some(
    (segment) =>
      segment.marker === 0xe1 && segment.identifier.includes('ns.adobe.com/xap'),
  );

export const jpegHasIptc = (buffer: Buffer): boolean =>
  jpegSegments(buffer).some(
    (segment) =>
      segment.marker === 0xed && segment.identifier.includes('Photoshop'),
  );

export interface ExifSummary {
  valid: boolean;
  /** IFD0 tag numbers, e.g. "0x8825" is the GPS IFD pointer. */
  ifd0Tags: string[];
  /** True when IFD0 points at a GPS IFD (tag 0x8825). */
  hasGpsIfd: boolean;
  /** GPS tag numbers found in the GPS IFD. */
  gpsTags: string[];
  /** True when IFD0 points at an Exif sub-IFD (tag 0x8769). */
  hasExifSubIfd: boolean;
}

const EMPTY_EXIF: ExifSummary = {
  valid: false,
  ifd0Tags: [],
  hasGpsIfd: false,
  gpsTags: [],
  hasExifSubIfd: false,
};

/**
 * Minimal TIFF/IFD walker for an EXIF payload (starting with "Exif\0\0"). It
 * reports the structural presence of the GPS IFD instead of grepping for text.
 */
export function parseExif(exif: Buffer | undefined): ExifSummary {
  if (!exif || exif.length < 14) return { ...EMPTY_EXIF };
  if (exif.toString('latin1', 0, 6) !== 'Exif\0\0') return { ...EMPTY_EXIF };
  const base = 6;
  const littleEndian = exif.toString('ascii', base, base + 2) === 'II';
  const u16 = (offset: number): number =>
    littleEndian ? exif.readUInt16LE(offset) : exif.readUInt16BE(offset);
  const u32 = (offset: number): number =>
    littleEndian ? exif.readUInt32LE(offset) : exif.readUInt32BE(offset);
  if (u16(base + 2) !== 42) return { ...EMPTY_EXIF };
  const ifd0 = base + u32(base + 4);
  if (ifd0 + 2 > exif.length) return { ...EMPTY_EXIF };
  const count = u16(ifd0);
  const ifd0Tags: string[] = [];
  let gpsOffset: number | null = null;
  let hasExifSubIfd = false;
  for (let k = 0; k < count; k++) {
    const entry = ifd0 + 2 + k * 12;
    if (entry + 12 > exif.length) break;
    const tag = u16(entry);
    ifd0Tags.push(`0x${tag.toString(16).padStart(4, '0')}`);
    if (tag === 0x8825) gpsOffset = base + u32(entry + 8);
    if (tag === 0x8769) hasExifSubIfd = true;
  }
  const gpsTags: string[] = [];
  if (gpsOffset !== null && gpsOffset + 2 <= exif.length) {
    const gpsCount = u16(gpsOffset);
    for (let k = 0; k < gpsCount; k++) {
      const entry = gpsOffset + 2 + k * 12;
      if (entry + 2 > exif.length) break;
      gpsTags.push(`0x${u16(entry).toString(16).padStart(4, '0')}`);
    }
  }
  return {
    valid: true,
    ifd0Tags,
    hasGpsIfd: gpsOffset !== null,
    gpsTags,
    hasExifSubIfd,
  };
}

export interface PngChunk {
  type: string;
  start: number;
  dataStart: number;
  length: number;
}

export function pngChunks(buffer: Buffer): PngChunk[] {
  const out: PngChunk[] = [];
  let i = 8;
  while (i + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(i);
    out.push({
      type: buffer.toString('ascii', i + 4, i + 8),
      start: i,
      dataStart: i + 8,
      length,
    });
    i += 12 + length;
  }
  return out;
}

export const pngChunkTypes = (buffer: Buffer): string[] =>
  pngChunks(buffer).map((chunk) => chunk.type);

export const pngHasTextChunk = (buffer: Buffer): boolean =>
  pngChunkTypes(buffer).some(
    (type) => type === 'tEXt' || type === 'zTXt' || type === 'iTXt',
  );

export const pngHasAnimation = (buffer: Buffer): boolean =>
  pngChunkTypes(buffer).includes('acTL');

export interface RiffChunk {
  type: string;
  dataStart: number;
  length: number;
}

export function riffChunks(buffer: Buffer): RiffChunk[] {
  const out: RiffChunk[] = [];
  let i = 12;
  while (i + 8 <= buffer.length && out.length < 64) {
    const type = buffer.toString('ascii', i, i + 4);
    const length = buffer.readUInt32LE(i + 4);
    out.push({ type, dataStart: i + 8, length });
    i += 8 + length + (length % 2);
  }
  return out;
}

export const riffChunkTypes = (buffer: Buffer): string[] =>
  riffChunks(buffer).map((chunk) => chunk.type);

// ---------------------------------------------------------------------------
// Fixture construction (genuine metadata-bearing images)
// ---------------------------------------------------------------------------

async function solidJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 40,
      height: 30,
      channels: 3,
      background: { r: 32, g: 96, b: 160 },
    },
  })
    .jpeg()
    .toBuffer();
}

/** JPEG carrying a real EXIF block with a GPS IFD (lat/long + refs). */
export async function jpegWithGpsExif(): Promise<Buffer> {
  const base = await solidJpeg();
  return sharp(base)
    .withExif({
      IFD0: { Make: 'ArkanTestCamera', Software: 'arkan-test-fixture' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '29/1 22/1 5000/1000',
        GPSLongitudeRef: 'E',
        GPSLongitude: '47/1 59/1 1000/1000',
      },
    })
    .jpeg()
    .toBuffer();
}

/**
 * JPEG whose EXIF declares an orientation. A distinct red band is placed on the
 * stored top rows so a wrong (or missing) auto-orient can be detected by looking
 * at where the band ends up.
 */
export async function orientedJpeg(orientation: number): Promise<Buffer> {
  const band = await sharp({
    create: { width: 40, height: 6, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const composed = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .composite([{ input: band, top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  return sharp(composed).withMetadata({ orientation }).jpeg().toBuffer();
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** PNG carrying a genuine tEXt chunk with a GPS-looking payload. */
export async function pngWithTextChunk(): Promise<Buffer> {
  const png = await sharp({
    create: {
      width: 40,
      height: 30,
      channels: 3,
      background: { r: 32, g: 96, b: 160 },
    },
  })
    .png()
    .toBuffer();
  const idat = pngChunks(png).find((chunk) => chunk.type === 'IDAT');
  if (!idat) throw new Error('fixture PNG has no IDAT chunk');
  const text = Buffer.concat([
    Buffer.from('Comment\0', 'latin1'),
    Buffer.from('GPS 29.37N 47.98E secret-location', 'latin1'),
  ]);
  return Buffer.concat([
    png.subarray(0, idat.start),
    pngChunk('tEXt', text),
    png.subarray(idat.start),
  ]);
}

/** WebP carrying both an EXIF chunk and an XMP chunk. */
export async function webpWithExifAndXmp(): Promise<Buffer> {
  const base = await solidJpeg();
  const webp = await sharp(base)
    .withExif({ IFD0: { Make: 'ArkanTestCamera' } })
    .webp()
    .toBuffer();
  const vp8x = riffChunks(webp).find((chunk) => chunk.type === 'VP8X');
  if (!vp8x) throw new Error('fixture WebP has no VP8X chunk');
  // Bit 2 of the VP8X flags byte advertises an XMP chunk.
  webp.writeUInt8(webp.readUInt8(vp8x.dataStart) | 0x04, vp8x.dataStart);
  const xmp = Buffer.from(
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">GPS 29.37N webp-xmp-secret</x:xmpmeta>',
    'utf8',
  );
  const chunk = Buffer.concat([
    Buffer.from('XMP ', 'ascii'),
    (() => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(xmp.length, 0);
      return length;
    })(),
    xmp,
    Buffer.alloc(xmp.length % 2),
  ]);
  const after = vp8x.dataStart + vp8x.length;
  const out = Buffer.concat([webp.subarray(0, after), chunk, webp.subarray(after)]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

function riffChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length, 0);
  return Buffer.concat([
    Buffer.from(type, 'ascii'),
    length,
    data,
    Buffer.alloc(data.length % 2),
  ]);
}

/** Genuine two-frame animated WebP. */
export async function animatedWebp(): Promise<Buffer> {
  const plain = await sharp(await solidJpeg()).webp().toBuffer();
  const vp8 = riffChunks(plain).find((chunk) => chunk.type === 'VP8 ');
  if (!vp8) throw new Error('fixture WebP has no VP8 chunk');
  const wholeChunk = plain.subarray(vp8.dataStart - 8, vp8.dataStart + vp8.length);
  const frameHeader = Buffer.alloc(16);
  frameHeader.writeUIntLE(0, 0, 3);
  frameHeader.writeUIntLE(0, 3, 3);
  frameHeader.writeUIntLE(39, 6, 3);
  frameHeader.writeUIntLE(29, 9, 3);
  frameHeader.writeUIntLE(100, 12, 3);
  const frame = Buffer.concat([frameHeader, wholeChunk]);
  const vp8xData = Buffer.alloc(10);
  vp8xData.writeUInt8(0x02, 0); // animation flag
  vp8xData.writeUIntLE(39, 4, 3);
  vp8xData.writeUIntLE(29, 7, 3);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8xData),
    riffChunk('ANIM', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0])])),
    riffChunk('ANMF', frame),
    riffChunk('ANMF', frame),
  ]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length + 4, 0);
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    riffSize,
    Buffer.from('WEBP', 'ascii'),
    body,
  ]);
}

/** Tiny PNG whose raster (64 MP) far exceeds the decoded pixel ceiling. */
export async function decompressionBombPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8000, height: 8000, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * JPEG that is under the 5 MB upload limit but whose sanitized re-encode exceeds
 * the 5 MB stored-artifact limit (high-entropy content re-encoded at quality 90).
 */
export async function jpegReencodingAboveStoredLimit(): Promise<Buffer> {
  const width = 4000;
  const height = 3000;
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 35 })
    .toBuffer();
}

/** JPEG signature followed by non-image garbage. */
export function truncatedJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x41)]);
}

/** PNG signature followed by non-image garbage. */
export function truncatedPng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0x42),
  ]);
}

/** JPEG signature wrapping a real PNG body (mislabelled / polyglot input). */
export async function mislabelledJpeg(): Promise<Buffer> {
  const png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), png.subarray(4)]);
}

/** A real GIF, an unsupported format that sharp can still decode. */
export async function gifBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .gif()
    .toBuffer();
}

/** A real TIFF, an unsupported format. */
export async function tiffBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .tiff()
    .toBuffer();
}

/** A real AVIF, an unsupported format. */
export async function avifBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .avif()
    .toBuffer();
}

export function svgBytes(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Stored-artifact helpers
// ---------------------------------------------------------------------------

/** Reads the bytes actually persisted for a FileAsset key (private storage root). */
export async function readStoredBytes(
  storageRoot: string,
  key: string,
): Promise<Buffer> {
  return readFile(path.join(storageRoot, 'property-images', key));
}

/** Lists every stored file path under the bucket directory. */
export async function listStoredFiles(storageRoot: string): Promise<string[]> {
  const bucket = path.join(storageRoot, 'property-images');
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  };
  await walk(bucket);
  return out;
}

export interface RawPixels {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Decodes an image to raw pixels for orientation assertions. */
export async function rawPixels(buffer: Buffer): Promise<RawPixels> {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

export function pixelAt(
  image: RawPixels,
  x: number,
  y: number,
): [number, number, number] {
  const offset = (y * image.width + x) * image.channels;
  return [
    image.data[offset] as number,
    image.data[offset + 1] as number,
    image.data[offset + 2] as number,
  ];
}

/** True when a pixel is predominantly red. */
export function isRed(pixel: [number, number, number]): boolean {
  return pixel[0] > 150 && pixel[1] < 100 && pixel[2] < 100;
}

/** True when a pixel is predominantly blue. */
export function isBlue(pixel: [number, number, number]): boolean {
  return pixel[2] > 150 && pixel[0] < 100 && pixel[1] < 100;
}
