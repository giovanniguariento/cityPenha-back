import { tryDecryptWordpressPassword } from './wordpressCredentials.helper';
import type { WordpressBasicAuth } from '../services/wordpress.service';

export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd();
}

/**
 * Resolve Basic auth for WordPress REST writes (media upload, create/update post).
 *
 * Prefer the **admin Application Password** (`ENV_API_WORDPRESS_*`): WP core Basic Auth
 * rejects normal account passwords. Author `wordpressUsername`/`wordpressPasswordEnc` are
 * for wp-admin login (admin UI), not for REST — only used here as a last-resort fallback.
 *
 * When `isAuthorAuth` is false, callers must pass `author: user.wordpressId` so the post
 * is still attributed to the app user.
 */
export function resolveShortPostWordpressAuth(user: {
  wordpressUsername: string | null;
  wordpressPasswordEnc: string | null;
}): { auth: WordpressBasicAuth; isAuthorAuth: boolean } | null {
  const adminUser = process.env.ENV_API_WORDPRESS_ADMIN_USER?.trim() ?? '';
  const adminPassword = process.env.ENV_API_WORDPRESS_ADMIN_PASSWORD?.trim() ?? '';
  if (adminUser && adminPassword && !/^CHANGE_ME/i.test(adminPassword)) {
    return { auth: { username: adminUser, password: adminPassword }, isAuthorAuth: false };
  }

  const userPassword = tryDecryptWordpressPassword(user.wordpressPasswordEnc);
  if (user.wordpressUsername?.trim() && userPassword) {
    return {
      auth: { username: user.wordpressUsername.trim(), password: userPassword },
      isAuthorAuth: true,
    };
  }

  return null;
}

/** Strip Gutenberg block comments so TipTap can edit clean HTML. */
export function stripGutenbergBlockComments(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
