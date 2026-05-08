import type { Request, Response } from 'express';
import { gamification } from '../services';
import { sendJsonSuccess } from '../lib/apiResponse';

export class MissionController {
  /**
   * GET /mission — retorna informações de todas as missões ativas.
   * Com Bearer de usuário registrado, inclui progress, completed e completedAt.
   */
  public getAll = async (req: Request, res: Response): Promise<void> => {
    const userId = req.appUser?.id;
    const missions = userId
      ? await gamification.getMissionsWithUserProgress(userId)
      : await gamification.getAllMissions();
    sendJsonSuccess(res, missions);
  };
}
