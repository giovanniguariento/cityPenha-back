import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { validationError } from '../lib/httpErrors';
import { shortThumbnailMaxBytes, shortVideoMaxBytes } from './uploadShortVideo';

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const articleMediaMaxBytes =
  Number(process.env.ARTICLE_MEDIA_MAX_BYTES) || shortVideoMaxBytes;

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: articleMediaMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype) || ALLOWED_VIDEO_MIME.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_ARTICLE_MEDIA_MIME'));
  },
}).single('file');

/**
 * Multipart for POST /post/media — single `file` (image or video) in memory.
 */
export function uploadArticleMedia(req: Request, res: Response, next: NextFunction): void {
  singleUpload(req, res, (err: unknown) => {
    if (!err) {
      const file = req.file;
      if (file && ALLOWED_IMAGE_MIME.has(file.mimetype) && file.size > shortThumbnailMaxBytes) {
        next(
          validationError(
            `Image exceeds the maximum size of ${shortThumbnailMaxBytes} bytes`
          )
        );
        return;
      }
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          validationError(
            `Upload exceeds the maximum size of ${articleMediaMaxBytes} bytes`
          )
        );
        return;
      }
      next(validationError(`Upload error: ${err.message}`));
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_ARTICLE_MEDIA_MIME') {
      next(
        validationError(
          'File must be JPEG, PNG, WebP, MP4, WebM or QuickTime'
        )
      );
      return;
    }
    next(err);
  });
}
