import type { User } from '../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import {
  encryptWordpressPassword,
  generateWordpressPassword,
  tryDecryptWordpressPassword,
} from '../../helpers/wordpressCredentials.helper';
import { wordpressService } from '../wordpress.service';
import { publishPressAuthorsService } from '../publishPressAuthors.service';
import { resolveSignupProfilePhoto } from '../../helpers/wordpressDefaultAvatar.helper';

export type WordpressCredentialsStatus = 'ready' | 'missing';

export type AdminWordpressAccessItem = {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  wordpressId: number | null;
  wordpressUsername: string | null;
  wordpressPassword: string | null;
  wordpressLoginUrl: string;
  credentialsStatus: WordpressCredentialsStatus;
};

function getWordpressLoginUrl(): string {
  return process.env.ENV_WORDPRESS_LOGIN_URL?.trim() ?? '';
}

function toAdminWordpressAccess(user: User): AdminWordpressAccessItem {
  const password = tryDecryptWordpressPassword(user.wordpressPasswordEnc);
  const credentialsStatus: WordpressCredentialsStatus =
    user.wordpressPasswordEnc && password ? 'ready' : 'missing';

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    wordpressId: user.wordpressId,
    wordpressUsername: user.wordpressUsername,
    wordpressPassword: password,
    wordpressLoginUrl: getWordpressLoginUrl(),
    credentialsStatus,
  };
}

export class WordpressAccessAdminService {
  async listWordpressAccess(options: {
    limit?: number;
    cursor?: string;
    q?: string;
  }): Promise<{ items: AdminWordpressAccessItem[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const q = options.q?.trim();

    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q } },
              { name: { contains: q } },
              { wordpressUsername: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor
        ? {
            cursor: { id: options.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = users.length > limit;
    const page = hasMore ? users.slice(0, limit) : users;

    return {
      items: page.map(toAdminWordpressAccess),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getWordpressAccess(userId: string): Promise<AdminWordpressAccessItem | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    return toAdminWordpressAccess(user);
  }

  async provisionWordpressAccess(
    userId: string,
    options: { force?: boolean } = {}
  ): Promise<AdminWordpressAccessItem> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    if (user.wordpressId == null) {
      throw new Error('NO_WORDPRESS_LINK');
    }
    // Sem `force`, mantém o comportamento idempotente (apenas usuários legados sem senha).
    // Com `force`, regenera a senha WP mesmo quando já existe uma criptografada — usado para
    // ressincronizar quando a senha guardada divergiu da senha real no WordPress.
    if (user.wordpressPasswordEnc && !options.force) {
      return toAdminWordpressAccess(user);
    }

    let username = user.wordpressUsername;
    if (!username) {
      const wpUser = await prisma.wp_users.findUnique({
        where: { ID: user.wordpressId },
        select: { user_login: true },
      });
      username = wpUser?.user_login ?? null;
    }
    if (!username) {
      throw new Error('WORDPRESS_USERNAME_NOT_FOUND');
    }

    const password = generateWordpressPassword();
    await wordpressService.updateUserPassword(user.wordpressId, password);

    await publishPressAuthorsService.ensureAuthorProfile({
      wordpressUserId: user.wordpressId,
      displayName: user.name,
      email: user.email,
    });
    await publishPressAuthorsService.ensureEditOwnProfileCapability(user.wordpressId);

    let photoUrl = user.photoUrl?.trim() ?? '';
    let defaultAvatarAttachmentId: number | undefined;

    if (!photoUrl) {
      const resolved = await resolveSignupProfilePhoto(user.email);
      photoUrl = resolved.photoUrl;
      defaultAvatarAttachmentId = resolved.defaultAvatarAttachmentId;
    }

    if (defaultAvatarAttachmentId != null) {
      await publishPressAuthorsService.setAuthorAvatarAttachment(
        user.wordpressId,
        defaultAvatarAttachmentId
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        wordpressUsername: username,
        wordpressPasswordEnc: encryptWordpressPassword(password),
        ...(photoUrl && !user.photoUrl?.trim() ? { photoUrl } : {}),
      },
    });

    return toAdminWordpressAccess(updated);
  }
}

export const wordpressAccessAdminService = new WordpressAccessAdminService();
