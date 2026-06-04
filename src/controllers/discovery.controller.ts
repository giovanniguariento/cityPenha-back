import type { Request, Response } from 'express';
import type { DiscoveryService } from '../services/discovery.service';
import { setFeedCacheHeaders } from '../helpers/feedCache.helper';
import { sendJsonSuccess } from '../lib/apiResponse';

export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  get = async (req: Request, res: Response): Promise<void> => {
    const worldNewsCategoriesQuery =
      typeof req.query.worldNewsCategories === 'string'
        ? req.query.worldNewsCategories
        : undefined;

    const payload = await this.discoveryService.buildDiscoveryPayload({
      worldNewsCategoriesQuery,
      userId: req.appUser?.id,
    });

    setFeedCacheHeaders(res, Boolean(req.appUser?.id));
    sendJsonSuccess(res, payload);
  };
}
