import type { Request, Response } from 'express';
import { gamification } from '../services';
import { sendJsonSuccess } from '../lib/apiResponse';

export class MissionController {
  /**
   * GET /mission — retorna informações de todas as missões.
   * Com Bearer de usuário registrado, inclui progress, completed e completedAt.
   */
  public getAll = async (req: Request, res: Response): Promise<void> => {
    const userId = req.appUser?.id;
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
    sendJsonSuccess(res, missions);
  };
}
