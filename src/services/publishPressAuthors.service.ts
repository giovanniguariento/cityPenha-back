import { Prisma } from '../generated/prisma/client';
import { fetchWithTimeout } from '../helpers/fetch.helper';
import {
  getPublishPressAuthorTermId,
  hasPublishPressAuthorProfile,
} from '../helpers/publishPressAuthors.helper';
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
   * If the author term is missing, creates the PublishPress profile from `wp_users`
   * and retries once. No-op if attachment id is invalid.
   */
  async setAuthorAvatarAttachment(
    wordpressUserId: number,
    attachmentId: number
  ): Promise<void> {
    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return;
    }

    let termId = await getPublishPressAuthorTermId(wordpressUserId);
    if (termId == null) {
      const ensured = await this.ensureAuthorProfileFromWpUser(wordpressUserId);
      if (!ensured) {
        logger.warn({ wordpressUserId }, 'PublishPress author term not found; skipping avatar');
        return;
      }
      termId = await getPublishPressAuthorTermId(wordpressUserId);
      if (termId == null) {
        logger.warn(
          { wordpressUserId },
          'PublishPress author term still missing after ensure; skipping avatar'
        );
        return;
      }
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

  /** Creates PublishPress author from `wp_users` when the term is missing. */
  private async ensureAuthorProfileFromWpUser(wordpressUserId: number): Promise<boolean> {
    const wpUser = await prisma.wp_users.findUnique({
      where: { ID: BigInt(wordpressUserId) },
      select: { display_name: true, user_email: true, user_login: true },
    });
    if (!wpUser) {
      logger.warn({ wordpressUserId }, 'wp_users row missing; cannot ensure PublishPress author');
      return false;
    }

    const displayName =
      wpUser.display_name?.trim() || wpUser.user_login?.trim() || `User ${wordpressUserId}`;
    const email = wpUser.user_email?.trim() || '';
    if (!email) {
      logger.warn({ wordpressUserId }, 'wp_users email missing; cannot ensure PublishPress author');
      return false;
    }

    try {
      await this.ensureAuthorProfile({
        wordpressUserId,
        displayName,
        email,
      });
      return true;
    } catch (err) {
      logger.warn(
        { err, wordpressUserId },
        'Failed to ensure PublishPress author profile before setting avatar'
      );
      return false;
    }
  }

  /**
   * Updates the PublishPress author display name used in post `authors[].display_name`.
   * Prefer the PublishPress REST API (updates term + termmeta correctly); also
   * writes `wp_terms.name` and refreshes denormalized `ppma_authors_name` postmeta.
   * Slug is left unchanged so author URLs stay stable.
   * No-op (with warning) when the author term is missing.
   */
  async updateAuthorDisplayName(wordpressUserId: number, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) {
      return;
    }

    const termId = await getPublishPressAuthorTermId(wordpressUserId);
    if (termId == null) {
      logger.warn(
        { wordpressUserId },
        'PublishPress author term not found; skipping display name update'
      );
      return;
    }

    const previous = await prisma.wp_terms.findUnique({
      where: { term_id: termId },
      select: { name: true },
    });
    const previousName = previous?.name?.trim() ?? '';

    const baseUrl = ppAuthorsBaseUrl();
    if (baseUrl) {
      const response = await fetchWithTimeout(`${baseUrl}/authors/${termId.toString()}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({ display_name: trimmed }),
      });
      if (!response.ok) {
        const body = await response.text();
        logger.warn(
          { wordpressUserId, termId: termId.toString(), status: response.status, body: body.slice(0, 300) },
          'PublishPress REST display name update failed; falling back to DB write'
        );
      }
    } else {
      logger.warn('PublishPress Authors API URL is not configured; updating term name in DB only');
    }

    // Ensure term name matches even if REST failed or ignored the field.
    await prisma.wp_terms.update({
      where: { term_id: termId },
      data: { name: trimmed },
    });

    await this.refreshDenormalizedAuthorNamesOnPosts(termId, previousName, trimmed);
  }

  /**
   * PublishPress stores comma-separated author names on each post as
   * `ppma_authors_name`. Replace the previous display name when present.
   */
  private async refreshDenormalizedAuthorNamesOnPosts(
    termId: bigint,
    previousName: string,
    newName: string
  ): Promise<void> {
    if (!previousName || previousName === newName) {
      // Still set single-author posts that only have this term.
      const postIds = await prisma.$queryRaw<Array<{ object_id: bigint }>>(
        Prisma.sql`
          SELECT tr.object_id AS object_id
          FROM wp_term_relationships tr
          INNER JOIN wp_term_taxonomy tt
            ON tt.term_taxonomy_id = tr.term_taxonomy_id
            AND tt.taxonomy = 'author'
          WHERE tt.term_id = ${termId}
        `
      );
      for (const row of postIds) {
        const existing = await prisma.wp_postmeta.findFirst({
          where: { post_id: row.object_id, meta_key: 'ppma_authors_name' },
          select: { meta_id: true, meta_value: true },
        });
        if (!existing) {
          await prisma.wp_postmeta.create({
            data: {
              post_id: row.object_id,
              meta_key: 'ppma_authors_name',
              meta_value: newName,
            },
          });
          continue;
        }
        const current = (existing.meta_value ?? '').trim();
        // Only overwrite when this post lists a single author (no comma list).
        if (!current.includes(',')) {
          await prisma.wp_postmeta.update({
            where: { meta_id: existing.meta_id },
            data: { meta_value: newName },
          });
        }
      }
      return;
    }

    const metas = await prisma.wp_postmeta.findMany({
      where: {
        meta_key: 'ppma_authors_name',
        meta_value: { contains: previousName },
      },
      select: { meta_id: true, meta_value: true },
    });

    for (const meta of metas) {
      const current = meta.meta_value ?? '';
      if (!current.includes(previousName)) continue;
      const updated = current
        .split(',')
        .map((part) => (part.trim() === previousName ? newName : part.trim()))
        .filter(Boolean)
        .join(', ');
      if (updated !== current) {
        await prisma.wp_postmeta.update({
          where: { meta_id: meta.meta_id },
          data: { meta_value: updated },
        });
      }
    }
  }
}

export const publishPressAuthorsService = new PublishPressAuthorsService();
