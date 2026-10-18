import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp, { type Metadata, type Sharp } from 'sharp';
import type { DetectedImageType } from './storage.service';

/**
 * Hard ceiling on decoded pixels. Guards against decompression bombs: a small
 * compressed file can describe an enormous raster, so we bound the raster itself
 * and not just the number of uploaded bytes. 50 MP comfortably covers modern
 * phone sensors (up to ~48 MP) while staying far below libvips' default.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** Hard ceiling on a single decoded dimension (rejects extreme aspect ratios). */
export const MAX_IMAGE_DIMENSION = 20_000;

/**
 * Hard ceiling on the sanitized artifact we are willing to store and serve. It is
 * equal to the documented upload limit so the persisted file can never grow past
 * the public contract (a re-encode may legitimately be larger than its source).
 */
export const MAX_SANITIZED_BYTES = 5 * 1024 * 1024;

export type SanitizedImageFormat = 'jpeg' | 'png' | 'webp';

/** The bytes we are willing to persist: decoded, re-encoded and metadata-free. */
export interface SanitizedImage {
  buffer: Buffer;
  sizeBytes: number;
  mimeType: string;
  extension: string;
  format: SanitizedImageFormat;
  width: number;
  height: number;
}

const FORMAT_BY_MIME: Record<string, SanitizedImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Untrusted uploads must never be retained in the libvips operation cache between
// requests: decode, re-encode, release.
sharp.cache(false);

/**
 * Decodes an uploaded image, discards every embedded metadata block and re-encodes
 * the pixels into the same supported format. Only the returned buffer may be
 * persisted; the original uploaded bytes are never written to storage.
 *
 * Failure modes fail closed:
 * - undecodable / corrupt / mismatched content -> 400
 * - over the pixel, dimension or output-size ceiling -> 413
 */
export async function sanitizeImageBuffer(
  input: Buffer,
  detected: DetectedImageType,
): Promise<SanitizedImage> {
  const expectedFormat = FORMAT_BY_MIME[detected.mimeType];
  if (!expectedFormat)
    throw new BadRequestException(
      'Unsupported image content. Only JPEG, PNG and WebP are accepted.',
    );

  const metadata = await readMetadata(input);

  // The bytes must decode to the very format their signature advertised; a
  // polyglot or mislabelled payload is rejected rather than re-encoded blindly.
  if (metadata.format !== expectedFormat)
    throw new BadRequestException(
      'The image content does not match a supported format.',
    );

  if ((metadata.pages ?? 1) > 1)
    throw new BadRequestException(
      'Animated or multipage images are not accepted.',
    );

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0)
    throw new BadRequestException('The image has invalid dimensions.');
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION)
    throw new PayloadTooLargeException(
      `The image dimensions exceed the maximum of ${MAX_IMAGE_DIMENSION} pixels per side.`,
    );
  if (width * height > MAX_IMAGE_PIXELS)
    throw new PayloadTooLargeException(
      `The image exceeds the maximum decoded size of ${MAX_IMAGE_PIXELS} pixels.`,
    );

  // Re-encode. `autoOrient()` bakes EXIF orientation into the pixels so the photo
  // never appears sideways; sharp drops all metadata on output by default.
  let output: Buffer;
  try {
    output = await encode(sanitizeInput(input), expectedFormat);
  } catch (error) {
    throw mapSharpError(error);
  }

  if (output.length === 0)
    throw new BadRequestException('The sanitized image is empty.');
  if (output.length > MAX_SANITIZED_BYTES)
    throw new PayloadTooLargeException(
      `The sanitized image exceeds the maximum size of ${MAX_SANITIZED_BYTES} bytes.`,
    );

  // Verify the artifact we are about to persist, never just the response: it must
  // decode again, keep the declared format and carry no residual metadata.
  const verified = await readMetadata(output, 'The sanitized image could not be verified.');
  if (verified.format !== expectedFormat)
    throw new BadRequestException(
      'The sanitized image could not be verified.',
    );
  if (verified.exif || verified.xmp || verified.iptc)
    throw new BadRequestException(
      'The image metadata could not be removed.',
    );

  return {
    buffer: output,
    sizeBytes: output.length,
    mimeType: `image/${expectedFormat}`,
    extension: expectedFormat === 'jpeg' ? '.jpg' : `.${expectedFormat}`,
    format: expectedFormat,
    width: verified.width ?? width,
    height: verified.height ?? height,
  };
}

function sanitizeInput(input: Buffer): Sharp {
  return sharp(input, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    animated: false,
    failOn: 'warning',
  }).autoOrient();
}

function encode(
  image: Sharp,
  format: SanitizedImageFormat,
): Promise<Buffer> {
  if (format === 'jpeg') return image.jpeg({ quality: 90 }).toBuffer();
  if (format === 'png') return image.png({ compressionLevel: 9 }).toBuffer();
  return image.webp({ quality: 90 }).toBuffer();
}

async function readMetadata(
  input: Buffer,
  failureMessage?: string,
): Promise<Metadata> {
  try {
    return await sharp(input, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      animated: false,
      failOn: 'warning',
    }).metadata();
  } catch (error) {
    throw mapSharpError(error, failureMessage);
  }
}

/**
 * Maps an image-processing failure to a safe HTTP error. The raw decoder message
 * is never surfaced or logged because it can echo attacker-controlled content.
 */
function mapSharpError(error: unknown, failureMessage?: string): Error {
  const message = error instanceof Error ? error.message : '';
  if (/pixel limit|exceeds.*pixel/i.test(message))
    return new PayloadTooLargeException(
      `The image exceeds the maximum decoded size of ${MAX_IMAGE_PIXELS} pixels.`,
    );
  return new BadRequestException(
    failureMessage ??
      'The image could not be decoded. It is corrupted or in an unsupported format.',
  );
}
