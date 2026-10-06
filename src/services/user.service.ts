import type { UserUncheckedCreateInput } from '../generated/prisma/models/User';
import type { User } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { wordpressService } from './wordpress.service';
import { publishPressAuthorsService } from './publishPressAuthors.service';

export class UserService {
  async create(data: UserUncheckedCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { firebaseUid } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async findByWordpressId(wordpressId: number): Promise<User | null> {
    return prisma.user.findUnique({ where: { wordpressId } });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async updateProfile(
    id: string,
    data: { name?: string; nickname?: string | null; about?: string | null }
  ): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }

  async updatePhotoUrl(id: string, photoUrl: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { photoUrl } });
  }

  /**
   * Pushes `user.name` to WordPress display_name and PublishPress author term name
   * so article author labels match the app profile. No-op without a linked WP id.
   * Throws on WP REST failure so callers can log / decide whether to fail the request.
   */
  async syncAuthorDisplayName(user: User): Promise<void> {
    if (user.wordpressId == null) {
      return;
    }
    const name = user.name?.trim();
    if (!name) {
      return;
    }

    await wordpressService.updateUserDisplayName(user.wordpressId, name);
    await publishPressAuthorsService.updateAuthorDisplayName(user.wordpressId, name);
    wordpressService.invalidatePostCaches();
    logger.info(
      { userId: user.id, wordpressId: user.wordpressId, name },
      'Synced author display name to WordPress / PublishPress'
    );
  }
}
