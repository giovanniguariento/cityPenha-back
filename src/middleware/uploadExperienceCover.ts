import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { validationError } from '../lib/httpErrors';
import { shortThumbnailMaxBytes } from './uploadShortVideo';

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const coverMaxBytes =
  Number(process.env.EXPERIENCE_COVER_MAX_BYTES) || shortThumbnailMaxBytes;

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: coverMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_EXPERIENCE_COVER_MIME'));
  },
}).single('cover');

/** Multipart cover image for experience create/update (`cover` field). */
export function uploadExperienceCover(req: Request, res: Response, next: NextFunction): void {
  singleUpload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(validationError(`Cover exceeds the maximum size of ${coverMaxBytes} bytes`));
        return;
      }
      next(validationError(`Upload error: ${err.message}`));
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_EXPERIENCE_COVER_MIME') {
      next(validationError('Cover must be JPEG, PNG or WebP'));
      return;
    }
    next(err);
  });
}
