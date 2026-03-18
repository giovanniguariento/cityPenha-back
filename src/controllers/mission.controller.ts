import { Request, Response, NextFunction } from 'express';
import { gamification } from '../services';

export class MissionController {
  /**
   * GET /mission — retorna informações de todas as missões.
   * Query: userId (opcional). Se informado, inclui progress, completed e completedAt do usuário.
   */
  public getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const missions = userId
        ? await gamification.getMissionsWithUserProgress(userId)
        : (await gamification.getAllMissions()).map((m) => ({
          id: m.id,
          key: m.key,
          title: m.title,
          description: m.description,
          target: m.target,
          coinReward: m.coinReward,
          xpReward: m.xpReward,
          progress: 0,
          completed: false,
          completedAt: null as string | null,
        }));
      res.status(200).json({ success: true, data: missions });
    } catch (error) {
      next(error);
    }
  };
}
