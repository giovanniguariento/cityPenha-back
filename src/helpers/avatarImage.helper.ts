import sharp from 'sharp';

const MAX_DIMENSION = Number(process.env.AVATAR_MAX_DIMENSION) || 512;
const JPEG_QUALITY = Number(process.env.AVATAR_JPEG_QUALITY) || 82;

export interface ProcessedAvatar {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

/**
 * Normalizes an uploaded/downloaded avatar into a small square JPEG:
 * fixes EXIF orientation, center-crops to a square, caps the largest side at
 * `AVATAR_MAX_DIMENSION`, and compresses to keep storage/bandwidth low.
 */
export async function processAvatarImage(input: Buffer): Promise<ProcessedAvatar> {
  const buffer = await sharp(input)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return { buffer, mimeType: 'image/jpeg', extension: 'jpg' };
}

/** Deterministic-ish filename so uploads are easy to trace back to a WP user. */
export function buildAvatarFilename(wordpressId: number, extension: string): string {
  return `avatar-${wordpressId}-${Date.now()}.${extension}`;
}
