/**
 * Backfills PublishPress author avatars from app `User.photoUrl` for users whose
 * author term has no custom avatar (or only the shared site default).
 *
 * Usage:
 *   npm run db:backfill-author-avatars -- --dry-run
 *   npm run db:backfill-author-avatars
 */

import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import { getPublishPressAuthorAvatarAttachmentId } from '../src/helpers/publishPressAuthors.helper';
import { resolveWordpressDefaultAvatar } from '../src/helpers/wordpressDefaultAvatar.helper';
import { userAvatarService } from '../src/services/userAvatar.service';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      wordpressId: { not: null },
      photoUrl: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  const defaultAvatar = await resolveWordpressDefaultAvatar();
  const defaultAttachmentId = defaultAvatar?.attachmentId ?? null;

  console.log(
    `Found ${users.length} user(s) with wordpressId + photoUrl. Mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`
  );
  if (defaultAttachmentId != null) {
    console.log(`Shared default avatar attachment id: ${defaultAttachmentId}`);
  }

  let synced = 0;
  let skippedAlready = 0;
  let skippedNoPhoto = 0;
  let failed = 0;

  for (const user of users) {
    const wordpressId = user.wordpressId;
    if (wordpressId == null) continue;

    const photoUrl = user.photoUrl?.trim() ?? '';
    if (!photoUrl) {
      skippedNoPhoto += 1;
      continue;
    }

    const currentAvatarId = await getPublishPressAuthorAvatarAttachmentId(wordpressId);
    const hasCustomAvatar =
      currentAvatarId != null &&
      (defaultAttachmentId == null || currentAvatarId !== defaultAttachmentId);

    if (hasCustomAvatar) {
      skippedAlready += 1;
      continue;
    }

    if (dryRun) {
      synced += 1;
      console.log(
        `  WOULD SYNC id=${user.id} wordpressId=${wordpressId} currentAvatar=${currentAvatarId ?? 'none'} photo=${photoUrl.slice(0, 80)}`
      );
      continue;
    }

    try {
      const result = await userAvatarService.syncExternalPhoto({
        userId: user.id,
        wordpressId,
        imageUrl: photoUrl,
      });
      if (result) {
        synced += 1;
        console.log(`  SYNCED id=${user.id} wordpressId=${wordpressId}`);
      } else {
        failed += 1;
        console.error(`  FAIL id=${user.id} wordpressId=${wordpressId}: sync returned null`);
      }
    } catch (err) {
      failed += 1;
      logger.warn({ err, userId: user.id, wordpressId }, 'backfill-author-avatars failed for user');
      console.error(`  FAIL id=${user.id} wordpressId=${wordpressId}: ${err}`);
    }
  }

  console.log(
    `\nDone. synced=${synced} alreadyOk=${skippedAlready} noPhoto=${skippedNoPhoto} failed=${failed}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
