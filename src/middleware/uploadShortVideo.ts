import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { validationError } from '../lib/httpErrors';

export const shortVideoMaxBytes =
  Number(process.env.SHORT_VIDEO_MAX_BYTES) || 80 * 1024 * 1024;

/** Optional JPEG/PNG/WebP poster for feed featured image (captured client-side). */
export const shortThumbnailMaxBytes = 5 * 1024 * 1024;

/** JSON metadata blob (caption/content, categoryId, title) — max 512KB (articles). */
export const shortMetaMaxBytes = 512 * 1024;

const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_THUMB_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_META_MIME = new Set(['application/json', 'text/plain', 'application/octet-stream']);

const fieldsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: shortVideoMaxBytes, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'video') {
      if (ALLOWED_VIDEO_MIME.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('INVALID_SHORT_VIDEO_MIME'));
      }
      return;
    }
    if (file.fieldname === 'thumbnail') {
      if (ALLOWED_THUMB_MIME.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('INVALID_SHORT_THUMB_MIME'));
      }
      return;
    }
    if (file.fieldname === 'meta') {
      // Browsers may send application/json, text/plain, or empty/octet-stream for Blob parts.
      if (!file.mimetype || ALLOWED_META_MIME.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('INVALID_SHORT_META_MIME'));
      }
      return;
    }
    cb(new Error('UNEXPECTED_SHORT_UPLOAD_FIELD'));
  },
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'meta', maxCount: 1 },
]);

/**
 * Multipart for POST /post/create:
 * - type=video: required `video`, optional `thumbnail`, optional `meta`
 * - type=article: optional `thumbnail` / `meta` (no video)
 * Memory storage only.
 */
export function uploadShortVideo(req: Request, res: Response, next: NextFunction): void {
  fieldsUpload(req, res, (err: unknown) => {
    if (!err) {
      const files = req.files as
        | { [field: string]: Express.Multer.File[] }
        | undefined;
      const thumb = files?.thumbnail?.[0];
      if (thumb && thumb.size > shortThumbnailMaxBytes) {
        next(
          validationError(
            `Thumbnail exceeds the maximum size of ${shortThumbnailMaxBytes} bytes`
          )
        );
        return;
      }
      const meta = files?.meta?.[0];
      if (meta && meta.size > shortMetaMaxBytes) {
        next(
          validationError(`Meta exceeds the maximum size of ${shortMetaMaxBytes} bytes`)
        );
        return;
      }
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        // Article posts may only send meta/thumbnail; still surface a clear size error.
        next(validationError(`Upload exceeds the maximum size of ${shortVideoMaxBytes} bytes`));
        return;
      }
      next(validationError(`Upload error: ${err.message}`));
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_SHORT_VIDEO_MIME') {
      next(validationError('Video must be MP4, WebM or QuickTime'));
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_SHORT_THUMB_MIME') {
      next(validationError('Thumbnail must be JPEG, PNG or WebP'));
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_SHORT_META_MIME') {
      next(validationError('Meta must be a JSON blob'));
      return;
    }
    if (err instanceof Error && err.message === 'UNEXPECTED_SHORT_UPLOAD_FIELD') {
      next(validationError('Unexpected upload field'));
      return;
    }
    next(err);
  });
}
