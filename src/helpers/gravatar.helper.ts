import { createHash } from 'node:crypto';

/**
 * Same scheme WordPress uses for default avatars: Gravatar URL from `user_email` MD5.
 * No HTTP from this server — only builds the URL; the app/browser loads Gravatar CDN.
 */
export function gravatarUrlFromEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const hash = createHash('md5').update(trimmed).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=96&d=mp`;
}
