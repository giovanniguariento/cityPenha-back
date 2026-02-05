import { prisma } from '../lib/prisma';

const XP_PER_READ = 10;

const DEFAULT_MISSIONS = [
  {
    key: 'read_10_posts',
    title: 'Read 10 posts',
    description: 'Read 10 different posts to complete this mission.',
    target: 10,
    coinReward: 50,
    xpReward: 0,
  },
];

export class GamificationService {
  async ensureDefaultMissions() {
    for (const m of DEFAULT_MISSIONS) {
      await prisma.mission.upsert({
        where: { key: m.key },
        update: {},
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

  async getCompletedMissionsCount(userId: string): Promise<number> {
    return prisma.userMission.count({ where: { userId, completed: true } });
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

    // ensure missions exist
    await this.ensureDefaultMissions();

    // if already recorded, do nothing
    const already = await prisma.readPost.findUnique({
      where: { userId_wordpressPostId: { userId, wordpressPostId } },
    });
    if (already) {
      return { already: true };
    }

    // transaction: create read record, add XP, update missions and reward if completed
    const result = await prisma.$transaction(async (tx) => {
      await tx.readPost.create({
        data: { userId, wordpressPostId },
      });

      // add XP for the read
      const userAfterXp = await tx.user.update({
        where: { id: userId },
        data: { xp: { increment: XP_PER_READ } },
      });

      // handle read-post missions (example: read_10_posts)
      const mission = await tx.mission.findUnique({ where: { key: 'read_10_posts' } });
      let missionUpdate = null;
      if (mission) {
        // upsert user mission progress
        const userMission = await tx.userMission.upsert({
          where: { userId_missionId: { userId, missionId: mission.id } },
          create: { userId, missionId: mission.id, progress: 1 },
          update: { progress: { increment: 1 } },
        });

        // if completed now, mark completed and reward coins/xp
        if (!userMission.completed && userMission.progress >= mission.target) {
          // mark completed and award
          await tx.userMission.update({
            where: { userId_missionId: { userId, missionId: mission.id } },
            data: { completed: true, completedAt: new Date(), progress: mission.target },
          });

          await tx.user.update({
            where: { id: userId },
            data: { coins: { increment: mission.coinReward }, xp: { increment: mission.xpReward } },
          });

          missionUpdate = { missionId: mission.id, completed: true, reward: { coins: mission.coinReward, xp: mission.xpReward } };
        } else {
          missionUpdate = { missionId: mission.id, completed: false, progress: userMission.progress };
        }
      }

      const updatedUser = await tx.user.findUnique({ where: { id: userId } });

      const completedCount = await tx.userMission.count({
        where: { userId, completed: true },
      });

      return { user: updatedUser, mission: missionUpdate, completedMissionsCount: completedCount };
    });

    return result;
  }
}

export const gamificationService = new GamificationService();

