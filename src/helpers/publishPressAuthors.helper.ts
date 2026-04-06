import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

/**
 * PublishPress Authors stores:
 * - Link WP user → author term: `wp_termmeta.meta_key` = `user_id_{wpUserId}` + join `wp_term_taxonomy.taxonomy = 'author'`
 * - Custom avatar: `wp_termmeta` for that `term_id`, `meta_key = 'avatar'`, `meta_value` = attachment post ID (see Author.php `get_custom_avatar_url`).
 *
 * Resolves attachment → public URL via `wp_posts.guid` for `post_type = 'attachment'`.
 */
export async function getPublishPressAuthorAvatarUrl(
  wordpressUserId: number
): Promise<string | null> {
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

  if (linkRows.length === 0) {
    return null;
  }

  const termId = linkRows[0].term_id;

  const avatarRow = await prisma.wp_termmeta.findFirst({
    where: {
      term_id: termId,
      meta_key: 'avatar',
    },
    select: { meta_value: true },
  });

  const raw = avatarRow?.meta_value?.trim();
  if (!raw) {
    return null;
  }

  const attachmentId = Number(raw);
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
    return null;
  }

  const att = await prisma.wp_posts.findFirst({
    where: {
      ID: BigInt(attachmentId),
      post_type: 'attachment',
    },
    select: { guid: true },
  });

  const url = att?.guid?.trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return null;
  }

  return url;
}
