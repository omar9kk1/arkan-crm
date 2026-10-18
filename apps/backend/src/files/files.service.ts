import { BadRequestException, Injectable } from '@nestjs/common';
import { FileAsset, Prisma } from '@prisma/client';
import type { ReadStream } from 'node:fs';
import {
  detectImageType,
  STORAGE_BUCKET,
  StorageService,
  type DetectedImageType,
} from './storage.service';
import {
  sanitizeImageBuffer,
  type SanitizedImage,
} from './image-sanitizer';

/** Documented maximum upload size for a single property image. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Shape of the single file produced by Nest's `FileInterceptor` (memory storage).
 * Declared locally because `@types/multer` is not installed; we never import the
 * multer type surface.
 */
export interface UploadedImageFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FilesService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Validates the presence, size and real bytes of the uploaded image. The client
   * MIME header and the filename extension are ignored; only the content signature
   * decides the type.
   */
  assertValidImage(file?: UploadedImageFile): DetectedImageType {
    if (!file)
      throw new BadRequestException(
        'Exactly one image file is required (multipart field "image").',
      );
    if (!file.buffer || file.buffer.length === 0)
      throw new BadRequestException('The uploaded image is empty.');
    if (file.size > MAX_IMAGE_BYTES)
      throw new BadRequestException(
        `The image exceeds the maximum allowed size of ${MAX_IMAGE_BYTES} bytes.`,
      );
    const detected = detectImageType(file.buffer);
    if (!detected)
      throw new BadRequestException(
        'Unsupported image content. Only JPEG, PNG and WebP are accepted.',
      );
    return detected;
  }

  /**
   * Decodes the uploaded bytes and returns a metadata-free, re-encoded artifact.
   * The original bytes are never persisted; only the returned buffer may be
   * written to storage. Throws on corrupt, oversized or animated input.
   */
  sanitizeImage(
    buffer: Buffer,
    detected: DetectedImageType,
  ): Promise<SanitizedImage> {
    return sanitizeImageBuffer(buffer, detected);
  }

  /** Persists the bytes to the private storage root and returns the opaque key. */
  persistBytes(buffer: Buffer, detected: DetectedImageType): Promise<string> {
    return this.storage.save(buffer, detected.extension);
  }

  /** Creates the FileAsset metadata row inside an existing transaction. */
  createAsset(
    tx: Prisma.TransactionClient,
    input: {
      key: string;
      mimeType: string;
      sizeBytes: number;
      uploadedById: string;
      propertyId: string;
    },
  ): Promise<FileAsset> {
    return tx.fileAsset.create({
      data: {
        bucket: STORAGE_BUCKET,
        key: input.key,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        uploadedById: input.uploadedById,
        propertyId: input.propertyId,
      },
    });
  }

  /** Opens a read stream for an already-authorized file. */
  openImage(asset: { key: string }): Promise<ReadStream> {
    return this.storage.open(asset.key);
  }

  /** Best-effort cleanup of bytes that were written before a failed transaction. */
  async discard(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch {
      // Cleanup is best-effort; the orphan is reported in the phase report.
    }
  }
}
