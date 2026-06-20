import type { User } from '../generated/prisma/client';

const WORDPRESS_FIELDS = ['wordpressId', 'wordpressUsername', 'wordpressPasswordEnc'] as const;

export type PublicUser = Omit<User, (typeof WORDPRESS_FIELDS)[number]>;

export function toPublicUser(user: User): PublicUser {
  const {
    wordpressId: _wordpressId,
    wordpressUsername: _wordpressUsername,
    wordpressPasswordEnc: _wordpressPasswordEnc,
    ...publicUser
  } = user;
  return publicUser;
}
