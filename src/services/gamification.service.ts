import { prisma } from '../lib/prisma';
import { SYSTEM_FOLDER_KEY_LIKES } from './postFolder.service';

const XP_PER_READ = 10;

const DEFAULT_MISSIONS = [
  {
    key: 'read_10_posts',
    title: 'Ler 10 publicações',
    description: 'Leia 10 publicações diferentes para completar esta missão.',
    target: 10,
    coinReward: 50,
    xpReward: 0,
  },
  {
    key: 'read_7_days',
    title: 'Missão de frequência',
    description: 'Entre no site e leia pelo menos uma notícia em 7 dias seguidos.',
    target: 7,
    coinReward: 30,
    xpReward: 0,
  },
  {
    key: 'like_10_posts',
    title: 'Curtir 10 publicações',
    description: 'Curta 10 publicações diferentes para completar esta missão.',
    target: 10,
    coinReward: 50,
    xpReward: 0,
  },
];

const DEFAULT_LEVELS = [
  {
    levelNumber: 1,
    minXp: 0,
    minCompletedMissions: 0,
  },
  {
    levelNumber: 2,
    minXp: 50,
    minCompletedMissions: 1,
  },
  {
    levelNumber: 3,
    minXp: 150,
    minCompletedMissions: 2,
  },
  {
    levelNumber: 4,
    minXp: 300,
    minCompletedMissions: 3,
  },
  {
    levelNumber: 5,
    minXp: 600,
    minCompletedMissions: 4,
  },
];

let ensuredDefaults = {
  missions: false,
  levels: false,
};

export class GamificationService {
  private async ensureDefaultMissionsInternal() {
    for (const m of DEFAULT_MISSIONS) {
      await prisma.mission.upsert({
        where: { key: m.key },
        update: {
          title: m.title,
          description: m.description,
          target: m.target,
          coinReward: m.coinReward,
          xpReward: m.xpReward,
        },
        create: {
          key: m.key,
          title: m.title,
          description: m.description,
          target: m.target,
          coinReward: m.coinReward,
          xpReward: m.xpReward,
        },
      });
    }
  }

  private async ensureDefaultLevelsInternal() {
    for (const level of DEFAULT_LEVELS) {
      await prisma.level.upsert({
        where: { levelNumber: level.levelNumber },
        update: {
          minXp: level.minXp,
          minCompletedMissions: level.minCompletedMissions,
        },
        create: {
          levelNumber: level.levelNumber,
          minXp: level.minXp,
          minCompletedMissions: level.minCompletedMissions,
        },
      });
    }
  }

  async ensureDefaultMissions() {
    if (!ensuredDefaults.missions) {
      await this.ensureDefaultMissionsInternal();
      ensuredDefaults.missions = true;
    }
  }

  async ensureDefaultLevels() {
    if (!ensuredDefaults.levels) {
      await this.ensureDefaultLevelsInternal();
      ensuredDefaults.levels = true;
    }
  }

  async getCompletedMissionsCount(userId: string): Promise<number> {
    return prisma.userMission.count({ where: { userId, completed: true } });
  }

  /**
   * Returns all missions (catalog only, no user progress).
   * Ensures default missions exist before returning.
   */
  async getAllMissions() {
    await this.ensureDefaultMissions();
    return prisma.mission.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Returns an array of dates (YYYY-MM-DD) when the user read at least one post.
   * Sorted ascending (oldest first).
   */
  async getDaysWithReads(userId: string): Promise<string[]> {
    const reads = await prisma.readPost.findMany({
      where: { userId },
      select: { createdAt: true },
    });
    const days = [...new Set(reads.map((r) => r.createdAt.toISOString().slice(0, 10)))].sort();
    return days;
  }

  /**
   * Given sorted array of date strings (YYYY-MM-DD), returns the length of the
   * longest run of consecutive calendar days.
   */
  getLongestConsecutiveStreak(days: string[]): number {
    if (days.length === 0) return 0;
    let maxStreak = 1;
    let currentStreak = 1;
    const oneDayMs = 24 * 60 * 60 * 1000;
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1]).getTime();
      const curr = new Date(days[i]).getTime();
      const diffDays = Math.round((curr - prev) / oneDayMs);
      if (diffDays === 1) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }
    return maxStreak;
  }

  /**
   * Returns all missions with the user's progress and completed status.
   * Frequency mission (read_7_days): progress = longest streak of consecutive days with reads.
   */
  async getMissionsWithUserProgress(userId: string) {
    await this.ensureDefaultMissions();

    const [missions, userMissions, daysWithReads] = await Promise.all([
      prisma.mission.findMany({ orderBy: { key: 'asc' } }),
      prisma.userMission.findMany({ where: { userId }, include: { mission: true } }),
      this.getDaysWithReads(userId),
    ]);

    const userMissionByMissionId = new Map(userMissions.map((um) => [um.missionId, um]));
    const consecutiveStreak = this.getLongestConsecutiveStreak(daysWithReads);

    return missions.map((m) => {
      const um = userMissionByMissionId.get(m.id);
      const isFrequencyMission = m.key === 'read_7_days';
      const progress = isFrequencyMission
        ? Math.min(consecutiveStreak, m.target)
        : (um?.progress ?? 0);
      const completed = um?.completed ?? false;
      const completedAt = um?.completedAt?.toISOString() ?? null;

      return {
        id: m.id,
        key: m.key,
        title: m.title,
        description: m.description,
        target: m.target,
        coinReward: m.coinReward,
        xpReward: m.xpReward,
        progress,
        completed,
        completedAt,
      };
    });
  }

  async getUserLevel(userId: string) {
    await this.ensureDefaultLevels();

    const [user, completedMissionsCount, levels] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      this.getCompletedMissionsCount(userId),
      prisma.level.findMany({ orderBy: { levelNumber: 'asc' } }),
    ]);

    if (!user || levels.length === 0) {
      return null;
    }

    let currentLevel = levels[0];
    for (const level of levels) {
      const meetsXp = user.xp >= level.minXp;
      const meetsMissions = completedMissionsCount >= level.minCompletedMissions;
      if (meetsXp && meetsMissions) {
        currentLevel = level;
      } else {
        break;
      }
    }

    return {
      levelNumber: currentLevel.levelNumber,
      minXp: currentLevel.minXp,
      minCompletedMissions: currentLevel.minCompletedMissions,
    };
  }

  /**
   * Record that a user fully read a post.
   * - Grants XP (once per post)
   * - Advances mission(s) and awards coins when completed
   */
  async recordReadPost(userId: string, wordpressPostId: number) {
    if (!userId || !wordpressPostId) {
      throw new Error('Invalid parameters');
    }

    // ensure missions and levels exist
    await Promise.all([this.ensureDefaultMissions(), this.ensureDefaultLevels()]);

    // if already recorded, do nothing (still return daysWithReads for frontend)
    const already = await prisma.readPost.findUnique({
      where: { userId_wordpressPostId: { userId, wordpressPostId } },
    });
    if (already) {
      const daysWithReads = await this.getDaysWithReads(userId);
      return { already: true, daysWithReads };
    }

    // transaction: create read record, add XP, update missions and reward if completed (timeout 15s to avoid holding connection too long)
    const result = await prisma.$transaction(async (tx) => {
      await tx.readPost.create({
        data: { userId, wordpressPostId },
      });

      // add XP for the read
      const userAfterXp = await tx.user.update({
        where: { id: userId },
        data: { xp: { increment: XP_PER_READ } },
      });

      // handle read-post missions (read_10_posts)
      const missionRead10 = await tx.mission.findUnique({ where: { key: 'read_10_posts' } });
      let missionUpdate = null;
      if (missionRead10) {
        const userMission = await tx.userMission.upsert({
          where: { userId_missionId: { userId, missionId: missionRead10.id } },
          create: { userId, missionId: missionRead10.id, progress: 1 },
          update: { progress: { increment: 1 } },
        });

        if (!userMission.completed && userMission.progress >= missionRead10.target) {
          await tx.userMission.update({
            where: { userId_missionId: { userId, missionId: missionRead10.id } },
            data: { completed: true, completedAt: new Date(), progress: missionRead10.target },
          });

          await tx.user.update({
            where: { id: userId },
            data: { coins: { increment: missionRead10.coinReward }, xp: { increment: missionRead10.xpReward } },
          });

          missionUpdate = { missionId: missionRead10.id, completed: true, reward: { coins: missionRead10.coinReward, xp: missionRead10.xpReward } };
        } else {
          missionUpdate = { missionId: missionRead10.id, completed: false, progress: userMission.progress };
        }
      }

      // handle frequency mission (read_7_days): progress = longest streak of consecutive days with reads
      const readPostsForUser = await tx.readPost.findMany({
        where: { userId },
        select: { createdAt: true },
      });
      const daysWithReadsSorted = [...new Set(readPostsForUser.map((r) => r.createdAt.toISOString().slice(0, 10)))].sort();
      const consecutiveStreak = this.getLongestConsecutiveStreak(daysWithReadsSorted);
      const missionFreq = await tx.mission.findUnique({ where: { key: 'read_7_days' } });
      if (missionFreq) {
        const progress = Math.min(consecutiveStreak, missionFreq.target);
        const userMissionFreq = await tx.userMission.upsert({
          where: { userId_missionId: { userId, missionId: missionFreq.id } },
          create: { userId, missionId: missionFreq.id, progress },
          update: { progress },
        });

        if (!userMissionFreq.completed && progress >= missionFreq.target) {
          await tx.userMission.update({
            where: { userId_missionId: { userId, missionId: missionFreq.id } },
            data: { completed: true, completedAt: new Date(), progress: missionFreq.target },
          });

          await tx.user.update({
            where: { id: userId },
            data: { coins: { increment: missionFreq.coinReward }, xp: { increment: missionFreq.xpReward } },
          });
        }
      }

      const updatedUser = await tx.user.findUnique({ where: { id: userId } });

      const completedCount = await tx.userMission.count({
        where: { userId, completed: true },
      });

      const daysWithReads = daysWithReadsSorted;

      return { user: updatedUser, mission: missionUpdate, completedMissionsCount: completedCount, daysWithReads };
    }, { timeout: 15_000 });

    const level = await this.getUserLevel(userId);

    return { ...result, level };
  }

  /**
   * Sincroniza a missão like_10_posts com o total atual de curtidas (pasta likes).
   * Regra reversível:
   * - cruza para >= target: conclui missão e concede recompensa
   * - cai para < target: revoga conclusão e remove recompensa
   */
  async syncLikeMissionState(userId: string) {
    if (!userId) {
      throw new Error('Invalid parameters');
    }

    await Promise.all([this.ensureDefaultMissions(), this.ensureDefaultLevels()]);

    const result = await prisma.$transaction(async (tx) => {
      const missionLike10 = await tx.mission.findUnique({ where: { key: 'like_10_posts' } });
      let missionUpdate = null;
      if (missionLike10) {
        const currentLikes = await tx.favorite.count({
          where: {
            folder: { userId, internalKey: SYSTEM_FOLDER_KEY_LIKES },
          },
        });
        const nextProgress = Math.min(currentLikes, missionLike10.target);
        const previous = await tx.userMission.findUnique({
          where: { userId_missionId: { userId, missionId: missionLike10.id } },
        });
        const wasCompleted = previous?.completed ?? false;
        const shouldBeCompleted = currentLikes >= missionLike10.target;
        const completedAt = shouldBeCompleted ? (previous?.completedAt ?? new Date()) : null;

        await tx.userMission.upsert({
          where: { userId_missionId: { userId, missionId: missionLike10.id } },
          create: {
            userId,
            missionId: missionLike10.id,
            progress: nextProgress,
            completed: shouldBeCompleted,
            completedAt,
          },
          update: {
            progress: nextProgress,
            completed: shouldBeCompleted,
            completedAt,
          },
        });

        if (!wasCompleted && shouldBeCompleted) {
          await tx.user.update({
            where: { id: userId },
            data: { coins: { increment: missionLike10.coinReward }, xp: { increment: missionLike10.xpReward } },
          });

          missionUpdate = {
            missionId: missionLike10.id,
            completed: true,
            reward: { coins: missionLike10.coinReward, xp: missionLike10.xpReward },
            progress: nextProgress,
          };
        } else if (wasCompleted && !shouldBeCompleted) {
          await tx.user.update({
            where: { id: userId },
            data: { coins: { decrement: missionLike10.coinReward }, xp: { decrement: missionLike10.xpReward } },
          });

          missionUpdate = {
            missionId: missionLike10.id,
            completed: false,
            revoked: { coins: missionLike10.coinReward, xp: missionLike10.xpReward },
            progress: nextProgress,
          };
        } else {
          missionUpdate = {
            missionId: missionLike10.id,
            completed: shouldBeCompleted,
            progress: nextProgress,
          };
        }
      }

      const updatedUser = await tx.user.findUnique({ where: { id: userId } });

      const completedCount = await tx.userMission.count({
        where: { userId, completed: true },
      });

      return { user: updatedUser, mission: missionUpdate, completedMissionsCount: completedCount };
    }, { timeout: 15_000 });

    const level = await this.getUserLevel(userId);

    return { ...result, level };
  }

  async recordLikePost(userId: string, wordpressPostId: number) {
    if (!userId || !wordpressPostId) {
      throw new Error('Invalid parameters');
    }
    return this.syncLikeMissionState(userId);
  }
}

export const gamificationService = new GamificationService();

