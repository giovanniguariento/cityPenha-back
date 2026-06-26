import { unserialize } from 'php-serialize';
import { prisma } from '../lib/prisma';
import { createTtlCache } from './cache.helper';
import { gravatarUrlFromEmail } from './gravatar.helper';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = createTtlCache<{ url: string; attachmentId?: number } | null>(CACHE_TTL_MS);

export type WordpressDefaultAvatar = {
  url: string;
  attachmentId?: number;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function parseAttachmentId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/** Walk PP settings for attachment id or URL under known / nested keys. */
function extractFromPpmaSettings(raw: unknown): WordpressDefaultAvatar | null {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (isHttpUrl(trimmed)) return { url: trimmed };
    const id = parseAttachmentId(trimmed);
    if (id != null) return { url: '', attachmentId: id };
    return null;
  }

  if (typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const directKeys = [
    'default_avatar',
    'author_default_avatar',
    'default_author_avatar',
    'avatar',
    'avatar_id',
    'default_avatar_id',
  ];

  for (const key of directKeys) {
    if (!(key in obj)) continue;
    const val = obj[key];
    if (typeof val === 'string' && isHttpUrl(val.trim())) {
      return { url: val.trim() };
    }
    const id = parseAttachmentId(val);
    if (id != null) return { url: '', attachmentId: id };
  }

  for (const nestedKey of ['author_profile', 'author_profiles', 'profiles']) {
    if (nestedKey in obj) {
      const nested = extractFromPpmaSettings(obj[nestedKey]);
      if (nested) return nested;
    }
  }

  for (const value of Object.values(obj)) {
    if (value != null && typeof value === 'object') {
      const nested = extractFromPpmaSettings(value);
      if (nested) return nested;
    }
  }

  return null;
}

async function attachmentIdToUrl(attachmentId: number): Promise<string | null> {
  const att = await prisma.wp_posts.findFirst({
    where: {
      ID: BigInt(attachmentId),
      post_type: 'attachment',
    },
    select: { guid: true },
  });
  const url = att?.guid?.trim();
  if (!url || !isHttpUrl(url)) return null;
  return url;
}

async function resolveAttachmentResult(
  partial: WordpressDefaultAvatar
): Promise<WordpressDefaultAvatar | null> {
  if (partial.url && isHttpUrl(partial.url)) {
    return partial.attachmentId != null
      ? partial
      : { url: partial.url };
  }
  if (partial.attachmentId != null) {
    const url = await attachmentIdToUrl(partial.attachmentId);
    if (!url) return null;
    return { url, attachmentId: partial.attachmentId };
  }
  return null;
}

async function loadPublishPressDefaultAvatar(): Promise<WordpressDefaultAvatar | null> {
  const row = await prisma.wp_options.findUnique({
    where: { option_name: 'multiple_authors_settings_options' },
    select: { option_value: true },
  });
  if (!row?.option_value) return null;

  try {
    const parsed = unserialize(row.option_value);
    const extracted = extractFromPpmaSettings(parsed);
    if (!extracted) return null;
    return resolveAttachmentResult(extracted);
  } catch {
    return null;
  }
}

async function loadWordpressCoreDefaultAvatar(): Promise<WordpressDefaultAvatar | null> {
  const rows = await prisma.wp_options.findMany({
    where: {
      option_name: { in: ['avatar_default', 'avatar_default_url'] },
    },
    select: { option_name: true, option_value: true },
  });

  const byName = new Map(rows.map((r) => [r.option_name, r.option_value]));
  const avatarDefault = byName.get('avatar_default')?.trim() ?? '';
  const avatarDefaultUrl = byName.get('avatar_default_url')?.trim() ?? '';

  if (avatarDefault === 'local' && avatarDefaultUrl && isHttpUrl(avatarDefaultUrl)) {
    return { url: avatarDefaultUrl };
  }

  return null;
}

function loadEnvDefaultAvatar(): WordpressDefaultAvatar | null {
  const url = process.env.DEFAULT_PROFILE_AVATAR_URL?.trim() ?? '';
  if (url && isHttpUrl(url)) {
    return { url };
  }
  return null;
}

async function loadWordpressDefaultAvatarCached(): Promise<WordpressDefaultAvatar | null> {
  const cached = cache.get('default');
  if (cached !== undefined) return cached;

  const fromPpma = await loadPublishPressDefaultAvatar();
  if (fromPpma) {
    cache.set('default', fromPpma);
    return fromPpma;
  }

  const fromCore = await loadWordpressCoreDefaultAvatar();
  if (fromCore) {
    cache.set('default', fromCore);
    return fromCore;
  }

  const fromEnv = loadEnvDefaultAvatar();
  cache.set('default', fromEnv);
  return fromEnv;
}

/**
 * Resolves site-wide default profile avatar from PublishPress / WordPress options.
 * Does not include Gravatar — use {@link resolveSignupProfilePhoto} for signup.
 */
export async function resolveWordpressDefaultAvatar(): Promise<WordpressDefaultAvatar | null> {
  return loadWordpressDefaultAvatarCached();
}

/**
 * Signup photo: WordPress/PublishPress default when configured; otherwise Gravatar from email.
 */
export async function resolveSignupProfilePhoto(
  email: string
): Promise<{ photoUrl: string; defaultAvatarAttachmentId?: number }> {
  const wpDefault = await loadWordpressDefaultAvatarCached();
  if (wpDefault?.url) {
    return {
      photoUrl: wpDefault.url,
      defaultAvatarAttachmentId: wpDefault.attachmentId,
    };
  }

  const gravatar = gravatarUrlFromEmail(email);
  return { photoUrl: gravatar ?? '' };
}
