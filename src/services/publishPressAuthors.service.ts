import { Prisma } from '../generated/prisma/client';
import { fetchWithTimeout } from '../helpers/fetch.helper';
import { hasPublishPressAuthorProfile } from '../helpers/publishPressAuthors.helper';
import {
  PPMA_EDIT_OWN_PROFILE,
  addCapability,
  addRoleCapability,
  hasCapability,
  roleHasCapability,
} from '../helpers/wpCapabilities.helper';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const credentials = Buffer.from(
  `${process.env.ENV_API_WORDPRESS_ADMIN_USER}:${process.env.ENV_API_WORDPRESS_ADMIN_PASSWORD}`
).toString('base64');

function ppAuthorsBaseUrl(): string {
  const explicit = process.env.ENV_API_WORDPRESS_PP?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const wp = process.env.ENV_API_WORDPRESS?.trim() ?? '';
  if (wp.includes('/wp-json/wp/v2')) {
    return wp.replace(/\/wp\/v2\/?$/, '/publishpress-authors/v1');
  }
  if (wp.includes('/wp-json/')) {
    return wp.replace(/\/wp-json\/.*$/, '/wp-json/publishpress-authors/v1');
  }
  return wp ? `${wp.replace(/\/$/, '')}/wp-json/publishpress-authors/v1` : '';
}

export type EnsureAuthorProfileInput = {
  wordpressUserId: number;
  displayName: string;
  email: string;
};

export class PublishPressAuthorsService {
  async ensureAuthorProfile(input: EnsureAuthorProfileInput): Promise<void> {
    const { wordpressUserId, displayName, email } = input;

    if (await hasPublishPressAuthorProfile(wordpressUserId)) {
      return;
    }

    const baseUrl = ppAuthorsBaseUrl();
    if (!baseUrl) {
      throw new Error('PublishPress Authors API URL is not configured');
    }

    const response = await fetchWithTimeout(`${baseUrl}/authors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        display_name: displayName,
        user_id: wordpressUserId,
        user_email: email,
      }),
    });

    if (response.ok) {
      return;
    }

    const body = await response.text();
    const duplicate =
      response.status === 409 ||
      body.toLowerCase().includes('already exists') ||
      body.toLowerCase().includes('duplicate');

    if (duplicate) {
      logger.warn(
        { wordpressUserId, status: response.status },
        'PublishPress author profile already exists'
      );
      return;
    }

    throw new Error(`Erro ao criar perfil PublishPress Authors: ${response.statusText} ${body}`);
  }

  async ensureEditOwnProfileCapability(wordpressUserId: number): Promise<void> {
    const meta = await prisma.wp_usermeta.findFirst({
      where: {
        user_id: BigInt(wordpressUserId),
        meta_key: 'wp_capabilities',
      },
      select: { umeta_id: true, meta_value: true },
    });

    const current = meta?.meta_value ?? '';
    if (hasCapability(current, PPMA_EDIT_OWN_PROFILE)) {
      return;
    }

    const updated = addCapability(current, PPMA_EDIT_OWN_PROFILE);

    if (meta) {
      await prisma.wp_usermeta.update({
        where: { umeta_id: meta.umeta_id },
        data: { meta_value: updated },
      });
      return;
    }

    await prisma.wp_usermeta.create({
      data: {
        user_id: BigInt(wordpressUserId),
        meta_key: 'wp_capabilities',
        meta_value: updated,
      },
    });
  }

  /** Idempotent: grants `ppma_edit_own_profile` to the global `author` role in `wp_user_roles`. */
  async ensureAuthorRolePpmaCapability(): Promise<void> {
    const option = await prisma.wp_options.findUnique({
      where: { option_name: 'wp_user_roles' },
      select: { option_id: true, option_value: true },
    });

    if (!option?.option_value) {
      logger.warn('wp_user_roles option not found; skipping author role PPMA capability');
      return;
    }

    if (roleHasCapability(option.option_value, 'author', PPMA_EDIT_OWN_PROFILE)) {
      return;
    }

    const updated = addRoleCapability(option.option_value, 'author', PPMA_EDIT_OWN_PROFILE);
    await prisma.wp_options.update({
      where: { option_id: option.option_id },
      data: { option_value: updated },
    });
    logger.info('Added ppma_edit_own_profile to author role in wp_user_roles');
  }

  /**
   * Sets PublishPress author avatar (`wp_termmeta.avatar` = attachment post ID).
   * No-op if author term is missing or attachment id is invalid.
   */
  async setAuthorAvatarAttachment(
    wordpressUserId: number,
    attachmentId: number
  ): Promise<void> {
    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return;
    }

    const metaKey = `user_id_${wordpressUserId}`;
    const linkRows = await prisma.$queryRaw<Array<{ term_id: bigint }>>(
      Prisma.sql`
        SELECT te.term_id AS term_id
        FROM wp_termmeta te
        INNER JOIN wp_term_taxonomy tt
          ON tt.term_id = te.term_id
          AND tt.taxonomy = 'author'
        WHERE te.meta_key = ${metaKey}
        LIMIT 1
      `
    );

    const termId = linkRows[0]?.term_id;
    if (termId == null) {
      logger.warn({ wordpressUserId }, 'PublishPress author term not found; skipping avatar');
      return;
    }

    const existing = await prisma.wp_termmeta.findFirst({
      where: { term_id: termId, meta_key: 'avatar' },
      select: { meta_id: true },
    });

    const metaValue = String(Math.floor(attachmentId));
    if (existing) {
      await prisma.wp_termmeta.update({
        where: { meta_id: existing.meta_id },
        data: { meta_value: metaValue },
      });
      return;
    }

    await prisma.wp_termmeta.create({
      data: {
        term_id: termId,
        meta_key: 'avatar',
        meta_value: metaValue,
      },
    });
  }
}

export const publishPressAuthorsService = new PublishPressAuthorsService();
