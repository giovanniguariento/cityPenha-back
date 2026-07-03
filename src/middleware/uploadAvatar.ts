import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { validationError } from '../lib/httpErrors';

const maxBytes = Number(process.env.AVATAR_MAX_UPLOAD_BYTES) || 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_AVATAR_MIME'));
    }
  },
}).single('file');

/**
 * Wraps multer so upload failures become our standard `VALIDATION_ERROR`
 * responses instead of raw `MulterError`s. Keeps the file in memory only
 * (`multer.memoryStorage`) so nothing is written to the container disk.
 */
export function uploadAvatar(req: Request, res: Response, next: NextFunction): void {
  singleUpload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(validationError(`Avatar exceeds the maximum size of ${maxBytes} bytes`));
        return;
      }
      next(validationError(`Upload error: ${err.message}`));
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_AVATAR_MIME') {
      next(validationError('Avatar must be a JPEG, PNG or WebP image'));
      return;
    }
    next(err);
  });
}
