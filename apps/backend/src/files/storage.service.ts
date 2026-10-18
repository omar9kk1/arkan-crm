import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, promises as fs, type ReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Logical bucket name used for every property image in local development. */
export const STORAGE_BUCKET = 'property-images';

export interface DetectedImageType {
  mimeType: string;
  extension: string;
}

interface ImageSignature {
  mimeType: string;
  extension: string;
  matches: (buffer: Buffer) => boolean;
}

// File signatures (magic bytes). We trust the bytes, never the extension or the
// client-provided MIME header.
const SIGNATURES: ImageSignature[] = [
  {
    mimeType: 'image/jpeg',
    extension: '.jpg',
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extension: '.png',
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/webp',
    extension: '.webp',
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/** Detects a supported image type from the actual bytes, or returns null. */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  for (const signature of SIGNATURES) {
    if (signature.matches(buffer))
      return { mimeType: signature.mimeType, extension: signature.extension };
  }
  return null;
}

/**
 * Local development storage abstraction. It stores opaque, server-generated keys
 * under a configurable root (default: `<home>/.arkan-crm/storage`, outside the
 * repository and outside temporary cleanup directories). It deliberately exposes
 * no bucket/key/path through the HTTP layer; the replaceable surface is small so a
 * future S3-compatible implementation can satisfy the same contract.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('STORAGE_ROOT');
    this.root =
      configured && configured.trim()
        ? path.resolve(configured.trim())
        : path.join(homedir(), '.arkan-crm', 'storage');
  }

  /** Directory that holds every key of this bucket (never returned to clients). */
  get bucketRoot(): string {
    return path.join(this.root, STORAGE_BUCKET);
  }

  /**
   * Writes bytes to a fresh, random key and returns that key. The key is entirely
   * server-generated (UUID + detected extension) so the original filename can never
   * influence the storage path.
   */
  async save(buffer: Buffer, extension: string): Promise<string> {
    const now = new Date();
    const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${prefix}/${randomUUID()}${extension}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // 'wx' fails instead of overwriting an existing file.
    await fs.writeFile(full, buffer, { flag: 'wx' });
    return key;
  }

  /** Resolves a key to an absolute path, rejecting traversal and absolute keys. */
  resolve(key: string): string {
    if (
      !key ||
      !/^[0-9a-zA-Z/_.-]+$/.test(key) ||
      key.includes('..') ||
      key.startsWith('/')
    )
      throw new Error('Invalid storage key');
    const base = path.resolve(this.bucketRoot);
    const full = path.resolve(base, key);
    if (full !== base && !full.startsWith(base + path.sep))
      throw new Error('Storage key escapes the storage root');
    return full;
  }

  /** Opens a read stream for an existing key. Throws when the object is missing. */
  async open(key: string): Promise<ReadStream> {
    const full = this.resolve(key);
    await fs.access(full);
    return createReadStream(full);
  }

  /** Best-effort deletion used for compensating a failed database transaction. */
  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}
