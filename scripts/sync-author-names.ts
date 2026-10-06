/**
 * Syncs app `User.name` to WordPress display_name and PublishPress author term name
 * for every user with a linked `wordpressId`.
 *
 * Usage:
 *   npm run db:sync-author-names -- --dry-run
 *   npm run db:sync-author-names
 */

import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import { UserService } from '../src/services/user.service';
import { getPublishPressAuthorTermId } from '../src/helpers/publishPressAuthors.helper';

const dryRun = process.argv.includes('--dry-run');
const userService = new UserService();

async function currentPpTermName(wordpressId: number): Promise<string | null> {
  const termId = await getPublishPressAuthorTermId(wordpressId);
  if (termId == null) return null;
  const term = await prisma.wp_terms.findUnique({
    where: { term_id: termId },
    select: { name: true },
  });
  return term?.name ?? null;
}

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { wordpressId: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `Found ${users.length} user(s) with wordpressId. Mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`
  );

  let synced = 0;
  let skippedAlready = 0;
  let skippedManualReview = 0;
  let failed = 0;

  for (const user of users) {
    const wordpressId = user.wordpressId;
    if (wordpressId == null) continue;

    const name = user.name?.trim() ?? '';
    if (!name || name === user.wordpressUsername) {
      skippedManualReview += 1;
      console.log(
        `  SKIP (manual review) id=${user.id} wordpressId=${wordpressId} name=${JSON.stringify(user.name)} username=${user.wordpressUsername}`
      );
      continue;
    }

    const ppName = await currentPpTermName(wordpressId);
    if (ppName === name) {
      skippedAlready += 1;
      continue;
    }

    if (dryRun) {
      synced += 1;
      console.log(
        `  WOULD SYNC id=${user.id} wordpressId=${wordpressId} ppName=${JSON.stringify(ppName)} -> ${JSON.stringify(name)}`
      );
      continue;
    }

    try {
      await userService.syncAuthorDisplayName(user);
      synced += 1;
      console.log(`  SYNCED id=${user.id} wordpressId=${wordpressId} -> ${JSON.stringify(name)}`);
    } catch (err) {
      failed += 1;
      logger.warn({ err, userId: user.id, wordpressId }, 'sync-author-names failed for user');
      console.error(`  FAIL id=${user.id} wordpressId=${wordpressId}: ${err}`);
    }
  }

  console.log(
    `\nDone. synced=${synced} alreadyOk=${skippedAlready} manualReview=${skippedManualReview} failed=${failed}`
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
