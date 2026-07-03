import type { User } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badGateway } from '../lib/httpErrors';
import { fetchWithTimeout } from '../helpers/fetch.helper';
import { getPublishPressAuthorAvatarAttachmentId } from '../helpers/publishPressAuthors.helper';
import { buildAvatarFilename, processAvatarImage } from '../helpers/avatarImage.helper';
import { wordpressService } from './wordpress.service';
import { publishPressAuthorsService } from './publishPressAuthors.service';
import { userService } from './index';

const EXTERNAL_PHOTO_TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_BYTES = Number(process.env.AVATAR_MAX_UPLOAD_BYTES) || 2 * 1024 * 1024;

export class UserAvatarService {
  /**
   * Uploads a new profile photo: stores it once in the WordPress Media Library,
   * points the PublishPress author avatar at it (so it shows on post bylines),
   * mirrors the public URL into `users.photoUrl`, and removes the previous
   * user-owned attachment to avoid accumulating files.
   */
  async updateUserAvatar(input: {
    userId: string;
    wordpressId: number;
    buffer: Buffer;
  }): Promise<User> {
    const { userId, wordpressId, buffer } = input;

    const previousAttachmentId = await getPublishPressAuthorAvatarAttachmentId(wordpressId);

    const processed = await processAvatarImage(buffer);
    const filename = buildAvatarFilename(wordpressId, processed.extension);

    let media;
    try {
      media = await wordpressService.uploadMedia({
        buffer: processed.buffer,
        filename,
        mimeType: processed.mimeType,
        authorId: wordpressId,
      });
    } catch (err) {
      logger.error({ err, wordpressId }, 'Failed to upload avatar to WordPress');
      throw badGateway('Failed to upload avatar to WordPress');
    }

    await publishPressAuthorsService.setAuthorAvatarAttachment(wordpressId, media.id);
    const updated = await userService.updatePhotoUrl(userId, media.sourceUrl);

    if (previousAttachmentId != null && previousAttachmentId !== media.id) {
      await this.deletePreviousAvatarIfOwned(previousAttachmentId, wordpressId);
    }

    return updated;
  }

  /**
   * Best-effort mirror of an external signup photo (e.g. Firebase/Google) into
   * WordPress so post bylines match the app. Returns the updated user on success
   * or `null` on any failure, leaving the original external URL in place.
   */
  async syncExternalPhoto(input: {
    userId: string;
    wordpressId: number;
    imageUrl: string;
  }): Promise<User | null> {
    const { userId, wordpressId, imageUrl } = input;
    try {
      const response = await fetchWithTimeout(imageUrl, {}, EXTERNAL_PHOTO_TIMEOUT_MS);
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        return null;
      }
      const downloaded = Buffer.from(await response.arrayBuffer());
      if (downloaded.byteLength === 0 || downloaded.byteLength > MAX_DOWNLOAD_BYTES) {
        return null;
      }
      return await this.updateUserAvatar({ userId, wordpressId, buffer: downloaded });
    } catch (err) {
      logger.warn({ err, wordpressId }, 'Failed to sync external signup photo to WordPress');
      return null;
    }
  }

  /**
   * Deletes the previous attachment only when it belongs to this WP user, so the
   * shared default avatar (owned by admin) is never removed.
   */
  private async deletePreviousAvatarIfOwned(
    attachmentId: number,
    wordpressId: number
  ): Promise<void> {
    const owned = await prisma.wp_posts.findFirst({
      where: {
        ID: BigInt(attachmentId),
        post_type: 'attachment',
        post_author: BigInt(wordpressId),
      },
      select: { ID: true },
    });
    if (!owned) {
      return;
    }
    await wordpressService.deleteMedia(attachmentId);
  }
}

export const userAvatarService = new UserAvatarService();
